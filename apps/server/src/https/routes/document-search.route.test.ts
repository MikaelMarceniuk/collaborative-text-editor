import { ObjectId } from 'mongodb';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { app } from '../../app.js';
import { collections } from '../../config/mongodb.js';
import { applyDocumentUpdate, CONTENT_FIELD } from '../../services/document-content.service.js';
import { asUser, createDocument, newUserId } from '../../test/helpers.js';

vi.mock('../middleware/auth.middleware.js', () => import('../../test/mock-auth.js'));

type Found = { _id: string; title: string; snippet: { text: string; matches: number[][] } | null };

const search = async (userId: ObjectId, q: string) => {
	const response = await request(app).get('/api/documents/search').query({ q }).set(asUser(userId));
	return { response, found: (response.body.documents ?? []) as Found[] };
};

const titlesOf = (found: Found[]) => found.map((document) => document.title);

// A document of `userId` whose content has `text`, as saved by the editor: the save is what fills the search text
const documentWith = async (userId: ObjectId, title: string, ...paragraphs: string[]) => {
	const document = await createDocument({ ownerId: userId, title });
	const ydoc = new Y.Doc();
	ydoc.getXmlFragment(CONTENT_FIELD).insert(
		0,
		paragraphs.map((text) => {
			const element = new Y.XmlElement('paragraph');
			element.insert(0, [new Y.XmlText(text)]);
			return element;
		}),
	);
	await applyDocumentUpdate({ documentId: document._id, update: Y.encodeStateAsUpdate(ydoc) });
	return document;
};

describe('GET /api/documents/search', () => {
	it('rejects requests without a session', async () => {
		const response = await request(app).get('/api/documents/search').query({ q: 'a' });

		expect(response.status).toBe(401);
	});

	it.each([
		['missing', undefined],
		['empty', ''],
		['blank', '   '],
		['too long', 'a'.repeat(101)],
	])('responds 400 when the search is %s', async (_name, q) => {
		const response = await request(app)
			.get('/api/documents/search')
			.query(q === undefined ? {} : { q })
			.set(asUser(newUserId()));

		expect(response.status).toBe(400);
	});

	it('is not read as the id of a document', async () => {
		const user = newUserId();

		const { response, found } = await search(user, 'anything');

		expect(response.status).toBe(200);
		expect(found).toEqual([]);
	});

	it('finds a document by a word in its content', async () => {
		const user = newUserId();
		await documentWith(user, 'Meeting notes', 'We agreed on the budget for next year.');
		await documentWith(user, 'Shopping list', 'Milk and bread.');

		const { found } = await search(user, 'budget');

		expect(titlesOf(found)).toEqual(['Meeting notes']);
	});

	it('finds a document by a word in its title, even before it has any content', async () => {
		const user = newUserId();
		await createDocument({ ownerId: user, title: 'Budget plan' });
		await createDocument({ ownerId: user, title: 'Other' });

		const { found } = await search(user, 'budget');

		expect(titlesOf(found)).toEqual(['Budget plan']);
		expect(found[0]!.snippet).toBeNull();
	});

	it('ignores case and accents, in both directions', async () => {
		const user = newUserId();
		await documentWith(user, 'A', 'Reunião sobre o CORAÇÃO do sistema');
		await documentWith(user, 'B', 'sem acentos: reuniao e coracao');

		expect(titlesOf((await search(user, 'coracao')).found).sort()).toEqual(['A', 'B']);
		expect(titlesOf((await search(user, 'REUNIÃO')).found).sort()).toEqual(['A', 'B']);
	});

	it('matches whole words only', async () => {
		const user = newUserId();
		await documentWith(user, 'Plural', 'Os projetos de amanhã');

		expect((await search(user, 'projeto')).found).toEqual([]);
		expect(titlesOf((await search(user, 'projetos')).found)).toEqual(['Plural']);
	});

	it('wants all the words, not any of them', async () => {
		const user = newUserId();
		await documentWith(user, 'Both', 'the plan and the project');
		await documentWith(user, 'Only plan', 'the plan');
		await documentWith(user, 'Only project', 'the project');

		const { found } = await search(user, 'plan project');

		expect(titlesOf(found)).toEqual(['Both']);
	});

	it('finds one word in the title and another in the content', async () => {
		const user = newUserId();
		await documentWith(user, 'Quarterly report', 'Revenue went up.');

		const { found } = await search(user, 'quarterly revenue');

		expect(titlesOf(found)).toEqual(['Quarterly report']);
	});

	it('puts a title match before a content match', async () => {
		const user = newUserId();
		await documentWith(user, 'Unrelated title', 'a note about the budget');
		await documentWith(user, 'Budget', 'nothing here');

		const { found } = await search(user, 'budget');

		expect(titlesOf(found)).toEqual(['Budget', 'Unrelated title']);
	});

	it('only looks at documents the person is a member of, in any role', async () => {
		const [alice, bob, carol] = [newUserId(), newUserId(), newUserId()];
		const mine = await documentWith(alice, 'Mine', 'secret word');
		await documentWith(bob, 'Not shared', 'secret word');
		const shared = await documentWith(bob, 'Shared as viewer', 'secret word');
		await collections.documents.updateOne(
			{ _id: shared._id },
			{ $push: { members: { userId: alice, role: 'viewer' } } },
		);

		const { found } = await search(alice, 'secret');

		expect(titlesOf(found).sort()).toEqual(['Mine', 'Shared as viewer']);
		expect(found.map((document) => document._id)).toContain(mine._id.toHexString());
		expect((await search(carol, 'secret')).found).toEqual([]);
	});

	it('shows where the word is, with the position of each match in the snippet', async () => {
		const user = newUserId();
		await documentWith(user, 'Notes', 'First paragraph.', 'Then a Reunião happens.');

		const [result] = (await search(user, 'reuniao')).found;

		expect(result!.snippet!.text).toBe('First paragraph. Then a Reunião happens.');
		const [[start, end]] = result!.snippet!.matches as [[number, number]];
		expect(result!.snippet!.text.slice(start, end)).toBe('Reunião');
	});

	it('leaves the binary content and the search text out of the answer', async () => {
		const user = newUserId();
		await documentWith(user, 'Notes', 'findable text');

		const { response } = await search(user, 'findable');

		expect(JSON.stringify(response.body)).not.toMatch(/ydocState|searchText|"score"/);
	});

	it('follows the edits: text that was removed is no longer found', async () => {
		const user = newUserId();
		const document = await createDocument({ ownerId: user, title: 'Draft' });
		const ydoc = new Y.Doc();
		const fragment = ydoc.getXmlFragment(CONTENT_FIELD);
		const element = new Y.XmlElement('paragraph');
		element.insert(0, [new Y.XmlText('temporary')]);
		fragment.insert(0, [element]);
		await applyDocumentUpdate({ documentId: document._id, update: Y.encodeStateAsUpdate(ydoc) });
		expect((await search(user, 'temporary')).found).toHaveLength(1);

		const before = Y.encodeStateVector(ydoc);
		fragment.delete(0, 1);
		await applyDocumentUpdate({
			documentId: document._id,
			update: Y.encodeStateAsUpdate(ydoc, before),
		});

		expect((await search(user, 'temporary')).found).toEqual([]);
	});

	it('does not let the search syntax of Mongo through', async () => {
		const user = newUserId();
		await documentWith(user, 'Has both', 'plan and project');
		await documentWith(user, 'Only plan', 'plan');

		// Unquoted, "-project" would exclude documents with "project"; here it is just the word
		expect(titlesOf((await search(user, 'plan -project')).found)).toEqual(['Has both']);
		expect((await search(user, '"plan')).response.status).toBe(200);
		expect((await search(user, '!!! ???')).response.status).toBe(200);
	});

	it('returns at most 20 documents', async () => {
		const user = newUserId();
		for (let index = 0; index < 25; index++) {
			await createDocument({ ownerId: user, title: `Report ${index}` });
		}

		const { found } = await search(user, 'report');

		expect(found).toHaveLength(20);
	});
});
