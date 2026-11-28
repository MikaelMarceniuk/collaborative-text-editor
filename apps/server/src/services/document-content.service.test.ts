import { ObjectId } from 'mongodb';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { collections } from '../config/mongodb.js';
import { createDocument, createUser } from '../test/helpers.js';
import {
	applyDocumentUpdate,
	CONTENT_FIELD,
	InvalidDocumentUpdateError,
	loadDocumentState,
	searchTextOf,
} from './document-content.service.js';

const update = (name: string, text: string) => {
	const ydoc = new Y.Doc();
	ydoc.getText(name).insert(0, text);
	return Y.encodeStateAsUpdate(ydoc);
};

const setup = async () => {
	const owner = await createUser();
	return (await createDocument({ ownerId: owner.id }))._id;
};

describe('document content', () => {
	it('starts empty', async () => {
		const documentId = await setup();

		const state = new Y.Doc();
		Y.applyUpdate(state, await loadDocumentState(documentId));

		expect(state.share.size).toBe(0);
	});

	it('merges updates instead of replacing the stored state', async () => {
		const documentId = await setup();

		// Simultaneous writes read the same state: the optimistic version makes the loser retry on top of the winner
		await Promise.all([
			applyDocumentUpdate({ documentId, update: update('a', 'first') }),
			applyDocumentUpdate({ documentId, update: update('b', 'second') }),
		]);

		const state = new Y.Doc();
		Y.applyUpdate(state, await loadDocumentState(documentId));
		expect(state.getText('a').toString()).toBe('first');
		expect(state.getText('b').toString()).toBe('second');
	});

	it('rejects an invalid update and keeps the stored state', async () => {
		const documentId = await setup();
		await applyDocumentUpdate({ documentId, update: update('a', 'kept') });

		await expect(
			applyDocumentUpdate({ documentId, update: new Uint8Array([255, 255, 255]) }),
		).rejects.toThrow(InvalidDocumentUpdateError);

		const state = new Y.Doc();
		Y.applyUpdate(state, await loadDocumentState(documentId));
		expect(state.getText('a').toString()).toBe('kept');
	});

	it('ignores an update for a document that no longer exists', async () => {
		await expect(
			applyDocumentUpdate({ documentId: new ObjectId(), update: update('a', 'lost') }),
		).resolves.toBeUndefined();
	});

	describe('search text', () => {
		const paragraph = (text: string) => {
			const element = new Y.XmlElement('paragraph');
			element.insert(0, [new Y.XmlText(text)]);
			return element;
		};

		const editorUpdate = (...texts: string[]) => {
			const ydoc = new Y.Doc();
			ydoc.getXmlFragment(CONTENT_FIELD).insert(0, texts.map(paragraph));
			return Y.encodeStateAsUpdate(ydoc);
		};

		const searchTextIn = async (documentId: ObjectId) =>
			(await collections.documents.findOne({ _id: documentId }))?.searchText;

		it('is written with the content', async () => {
			const documentId = await setup();

			await applyDocumentUpdate({ documentId, update: editorUpdate('Hello', 'world') });

			expect(await searchTextIn(documentId)).toBe('Hello world');
		});

		it('follows the whole stored content, not only the last update', async () => {
			const documentId = await setup();
			const ydoc = new Y.Doc();
			const fragment = ydoc.getXmlFragment(CONTENT_FIELD);

			fragment.insert(0, [paragraph('first')]);
			await applyDocumentUpdate({ documentId, update: Y.encodeStateAsUpdate(ydoc) });
			const before = Y.encodeStateVector(ydoc);
			fragment.insert(1, [paragraph('second')]);
			await applyDocumentUpdate({ documentId, update: Y.encodeStateAsUpdate(ydoc, before) });

			expect(await searchTextIn(documentId)).toBe('first second');
		});

		it('drops text that was deleted', async () => {
			const documentId = await setup();
			const ydoc = new Y.Doc();
			const fragment = ydoc.getXmlFragment(CONTENT_FIELD);
			fragment.insert(0, [paragraph('keep'), paragraph('remove')]);
			await applyDocumentUpdate({ documentId, update: Y.encodeStateAsUpdate(ydoc) });

			const before = Y.encodeStateVector(ydoc);
			fragment.delete(1, 1);
			await applyDocumentUpdate({ documentId, update: Y.encodeStateAsUpdate(ydoc, before) });

			expect(await searchTextIn(documentId)).toBe('keep');
		});

		it('is empty when the update has no editor content', async () => {
			const documentId = await setup();

			await applyDocumentUpdate({ documentId, update: update('a', 'not editor text') });

			expect(await searchTextIn(documentId)).toBe('');
		});

		it('searchTextOf reads an encoded state', () => {
			expect(searchTextOf(editorUpdate('one', 'two'))).toBe('one two');
		});
	});
});
