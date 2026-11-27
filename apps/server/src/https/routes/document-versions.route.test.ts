import { ObjectId } from 'mongodb';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { app } from '../../app.js';
import { collections } from '../../config/mongodb.js';
import { deleteGuestDocuments } from '../../services/delete-guest-documents.js';
import {
	applyDocumentUpdate,
	CONTENT_FIELD,
	loadDocumentState,
} from '../../services/document-content.service.js';
import { createVersion, listVersions } from '../../services/document-versions.service.js';
import { asUser, createDocument, createUser, newUserId } from '../../test/helpers.js';
import { MAX_VERSION_WRITES_PER_HOUR } from '../middleware/version-rate-limit.middleware.js';

vi.mock('../middleware/auth.middleware.js', () => import('../../test/mock-auth.js'));

const contentUpdate = (text: string) => {
	const ydoc = new Y.Doc();
	const paragraph = new Y.XmlElement('paragraph');
	paragraph.insert(0, [new Y.XmlText(text)]);
	ydoc.getXmlFragment(CONTENT_FIELD).insert(0, [paragraph]);
	return Y.encodeStateAsUpdate(ydoc);
};

const contentOf = (state: Uint8Array) => {
	const ydoc = new Y.Doc();
	Y.applyUpdate(ydoc, state);
	return ydoc.getXmlFragment(CONTENT_FIELD).toString();
};

// A document with an owner, an editor and a viewer, plus a user outside it, and a saved text
const setup = async (text = 'current text') => {
	const [owner, editor, viewer, stranger] = await Promise.all([
		createUser({ name: 'Olivia Owner' }),
		createUser({ name: 'Eddie Editor' }),
		createUser({ name: 'Vera Viewer' }),
		createUser({ name: 'Sam Stranger' }),
	]);
	const document = await createDocument({
		ownerId: owner.id,
		members: [
			{ userId: editor.id, role: 'editor' },
			{ userId: viewer.id, role: 'viewer' },
		],
	});
	if (text) await applyDocumentUpdate({ documentId: document._id, update: contentUpdate(text) });

	return { document, users: { owner, editor, viewer, stranger } };
};

const base = (documentId: ObjectId) => `/api/documents/${documentId}/versions`;

describe('GET /api/documents/:id/versions', () => {
	it.each(['owner', 'editor', 'viewer'] as const)('lets the %s list the versions', async (role) => {
		const { document, users } = await setup();
		await createVersion({
			documentId: document._id,
			kind: 'manual',
			state: contentUpdate('old'),
			label: 'before the rewrite',
			createdBy: users.editor.id,
		});
		await createVersion({ documentId: document._id, kind: 'auto', state: contentUpdate('older') });

		const response = await request(app).get(base(document._id)).set(asUser(users[role].id));

		expect(response.status).toBe(200);
		expect(response.body.versions).toHaveLength(2);
		expect(response.body.versions[0]).toMatchObject({ kind: 'auto', createdBy: null });
		expect(response.body.versions[1]).toMatchObject({
			kind: 'manual',
			label: 'before the rewrite',
			createdBy: { userId: users.editor.id.toHexString(), name: 'Eddie Editor' },
		});
		expect(response.body.versions[0]).not.toHaveProperty('snapshot');
	});

	it('answers 404 to someone outside the document, 401 to nobody', async () => {
		const { document, users } = await setup();

		await request(app).get(base(document._id)).set(asUser(users.stranger.id)).expect(404);
		await request(app).get(base(document._id)).expect(401);
	});

	it('does not list the versions of another document', async () => {
		const { document, users } = await setup();
		const other = await setup();
		await createVersion({
			documentId: other.document._id,
			kind: 'manual',
			state: contentUpdate('x'),
		});

		const response = await request(app).get(base(document._id)).set(asUser(users.owner.id));

		expect(response.body.versions).toEqual([]);
	});
});

describe('GET /api/documents/:id/versions/:versionId', () => {
	it('gives the snapshot in base64, to any member', async () => {
		const { document, users } = await setup();
		const version = await createVersion({
			documentId: document._id,
			kind: 'manual',
			state: contentUpdate('as it was'),
		});

		const response = await request(app)
			.get(`${base(document._id)}/${version._id}`)
			.set(asUser(users.viewer.id));

		expect(response.status).toBe(200);
		expect(response.body.version._id).toBe(version._id.toHexString());
		expect(contentOf(Buffer.from(response.body.snapshot, 'base64'))).toContain('as it was');
	});

	it('answers 404 to a version of another document, or one that does not exist', async () => {
		const { document, users } = await setup();
		const other = await setup();
		const foreign = await createVersion({
			documentId: other.document._id,
			kind: 'manual',
			state: contentUpdate('x'),
		});

		await request(app)
			.get(`${base(document._id)}/${foreign._id}`)
			.set(asUser(users.owner.id))
			.expect(404);
		await request(app)
			.get(`${base(document._id)}/${new ObjectId()}`)
			.set(asUser(users.owner.id))
			.expect(404);
		await request(app)
			.get(`${base(document._id)}/nope`)
			.set(asUser(users.owner.id))
			.expect(404);
	});
});

describe('POST /api/documents/:id/versions', () => {
	it.each(['owner', 'editor'] as const)('lets the %s save a version', async (role) => {
		const { document, users } = await setup('what is there now');

		const response = await request(app)
			.post(base(document._id))
			.set(asUser(users[role].id))
			.send({ label: '  first draft  ' });

		expect(response.status).toBe(201);
		expect(response.body.version).toMatchObject({ kind: 'manual', label: 'first draft' });
		expect(response.body.version).not.toHaveProperty('snapshot');
		const [saved] = await listVersions(document._id);
		expect(saved?.createdBy?.equals(users[role].id)).toBe(true);
	});

	it('keeps the content of the document in the version', async () => {
		const { document, users } = await setup('what is there now');

		const { body } = await request(app).post(base(document._id)).set(asUser(users.owner.id));
		const response = await request(app)
			.get(`${base(document._id)}/${body.version._id}`)
			.set(asUser(users.owner.id));

		expect(contentOf(Buffer.from(response.body.snapshot, 'base64'))).toContain('what is there now');
	});

	it('works without a body, and an empty label is no label', async () => {
		const { document, users } = await setup();

		const response = await request(app)
			.post(base(document._id))
			.set(asUser(users.owner.id))
			.send({ label: '   ' });

		expect(response.status).toBe(201);
		expect(response.body.version).not.toHaveProperty('label');
	});

	it('refuses a viewer and a stranger', async () => {
		const { document, users } = await setup();

		await request(app).post(base(document._id)).set(asUser(users.viewer.id)).expect(403);
		await request(app).post(base(document._id)).set(asUser(users.stranger.id)).expect(404);
		expect(await listVersions(document._id)).toHaveLength(0);
	});

	it('refuses a label that is too long, and a document with nothing in it', async () => {
		const { document, users } = await setup();
		const empty = await setup('');

		await request(app)
			.post(base(document._id))
			.set(asUser(users.owner.id))
			.send({ label: 'x'.repeat(101) })
			.expect(400);
		await request(app).post(base(empty.document._id)).set(asUser(empty.users.owner.id)).expect(400);
	});
});

describe('POST /api/documents/:id/versions again, with nothing changed', () => {
	it('answers the newest version instead of making a copy of the same text', async () => {
		const { document, users } = await setup('what is there now');
		const first = await request(app).post(base(document._id)).set(asUser(users.owner.id));

		const second = await request(app).post(base(document._id)).set(asUser(users.editor.id));

		expect(first.status).toBe(201);
		expect(second.status).toBe(200);
		expect(second.body.version._id).toBe(first.body.version._id);
		expect(await listVersions(document._id)).toHaveLength(1);
	});

	it('gives the name to that version when the person names it, and makes a new one once the text changes', async () => {
		const { document, users } = await setup('what is there now');
		await request(app).post(base(document._id)).set(asUser(users.owner.id)).expect(201);

		const named = await request(app)
			.post(base(document._id))
			.set(asUser(users.editor.id))
			.send({ label: 'Ready to send' });
		await applyDocumentUpdate({ documentId: document._id, update: contentUpdate('more text') });
		const changed = await request(app).post(base(document._id)).set(asUser(users.owner.id));

		expect(named.status).toBe(200);
		expect(named.body.version).toMatchObject({ kind: 'manual', label: 'Ready to send' });
		expect(changed.status).toBe(201);
		expect(changed.body.version._id).not.toBe(named.body.version._id);
		expect(await listVersions(document._id)).toHaveLength(2);
	});
});

describe('POST /api/documents/:id/versions/:versionId/restore', () => {
	const restoreUrl = (documentId: ObjectId, versionId: ObjectId) =>
		`${base(documentId)}/${versionId}/restore`;

	it('puts the content of the version back, after keeping the current one', async () => {
		const { document, users } = await setup('the new text');
		const version = await createVersion({
			documentId: document._id,
			kind: 'manual',
			state: contentUpdate('the old text'),
		});

		await request(app)
			.post(restoreUrl(document._id, version._id))
			.set(asUser(users.editor.id))
			.expect(204);

		const content = contentOf(await loadDocumentState(document._id));
		expect(content).toContain('the old text');
		expect(content).not.toContain('the new text');
		const versions = await listVersions(document._id);
		expect(versions.map(({ kind }) => kind)).toEqual(['before-restore', 'manual']);
		expect(versions[0]?.createdBy?.equals(users.editor.id)).toBe(true);
	});

	it('can be undone with the version it kept', async () => {
		const { document, users } = await setup('the new text');
		const old = await createVersion({
			documentId: document._id,
			kind: 'manual',
			state: contentUpdate('the old text'),
		});
		await request(app)
			.post(restoreUrl(document._id, old._id))
			.set(asUser(users.owner.id))
			.expect(204);
		const [kept] = await listVersions(document._id);

		await request(app)
			.post(restoreUrl(document._id, kept!._id))
			.set(asUser(users.owner.id))
			.expect(204);

		expect(contentOf(await loadDocumentState(document._id))).toContain('the new text');
	});

	it('does not keep a second copy of what the newest version already has', async () => {
		const { document, users } = await setup('the new text');
		const old = await createVersion({
			documentId: document._id,
			kind: 'manual',
			state: contentUpdate('the old text'),
		});
		// The current text is already kept by a version
		await request(app).post(base(document._id)).set(asUser(users.owner.id)).expect(201);

		await request(app)
			.post(restoreUrl(document._id, old._id))
			.set(asUser(users.owner.id))
			.expect(204);

		expect((await listVersions(document._id)).map(({ kind }) => kind)).toEqual([
			'manual',
			'manual',
		]);
	});

	it('does not keep a version of a document with nothing in it', async () => {
		const { document, users } = await setup('');
		const version = await createVersion({
			documentId: document._id,
			kind: 'manual',
			state: contentUpdate('the old text'),
		});

		await request(app)
			.post(restoreUrl(document._id, version._id))
			.set(asUser(users.owner.id))
			.expect(204);

		expect(await listVersions(document._id)).toHaveLength(1);
		expect(contentOf(await loadDocumentState(document._id))).toContain('the old text');
	});

	it('refuses a viewer and a stranger, and changes nothing', async () => {
		const { document, users } = await setup('the new text');
		const version = await createVersion({
			documentId: document._id,
			kind: 'manual',
			state: contentUpdate('the old text'),
		});

		await request(app)
			.post(restoreUrl(document._id, version._id))
			.set(asUser(users.viewer.id))
			.expect(403);
		await request(app)
			.post(restoreUrl(document._id, version._id))
			.set(asUser(users.stranger.id))
			.expect(404);

		expect(contentOf(await loadDocumentState(document._id))).toContain('the new text');
		expect(await listVersions(document._id)).toHaveLength(1);
	});

	it('answers 404 to a version of another document', async () => {
		const { document, users } = await setup();
		const other = await setup();
		const foreign = await createVersion({
			documentId: other.document._id,
			kind: 'manual',
			state: contentUpdate('x'),
		});

		await request(app)
			.post(restoreUrl(document._id, foreign._id))
			.set(asUser(users.owner.id))
			.expect(404);
		await request(app)
			.post(restoreUrl(document._id, new ObjectId()))
			.set(asUser(newUserId()))
			.expect(404);
	});
});

describe('deleting documents', () => {
	it('deletes the versions with the document', async () => {
		const { document, users } = await setup();
		const other = await setup();
		await createVersion({ documentId: document._id, kind: 'manual', state: contentUpdate('x') });
		await createVersion({
			documentId: other.document._id,
			kind: 'manual',
			state: contentUpdate('y'),
		});

		await request(app)
			.delete(`/api/documents/${document._id}`)
			.set(asUser(users.owner.id))
			.expect(204);

		expect(await listVersions(document._id)).toHaveLength(0);
		expect(await listVersions(other.document._id)).toHaveLength(1);
	});

	it('deletes the versions of the documents of a guest', async () => {
		const guest = await createUser({ isAnonymous: true });
		const own = await createDocument({ ownerId: guest.id });
		const other = await setup();
		await createVersion({ documentId: own._id, kind: 'manual', state: contentUpdate('x') });
		await createVersion({
			documentId: other.document._id,
			kind: 'manual',
			state: contentUpdate('y'),
		});

		await deleteGuestDocuments({ guestUserId: guest.id.toHexString() });

		expect(await collections.documents.findOne({ _id: own._id })).toBeNull();
		expect(await listVersions(own._id)).toHaveLength(0);
		expect(await listVersions(other.document._id)).toHaveLength(1);
	});
});

describe('the limit of versions per hour', () => {
	it('answers 429 after too many saves, counts the restores with them, and counts per user', async () => {
		const { document, users } = await setup('what is there now');
		const asEditor = asUser(users.editor.id);

		// Nothing changes between them, so the versions are not new ones: the limit counts the requests anyway
		for (let attempt = 0; attempt < MAX_VERSION_WRITES_PER_HOUR - 1; attempt++) {
			await request(app)
				.post(base(document._id))
				.set(asEditor)
				.expect(201 - Number(attempt > 0));
		}
		const [first] = await listVersions(document._id);
		// The last one allowed is a restore: it shares the count
		await request(app)
			.post(`${base(document._id)}/${first!._id}/restore`)
			.set(asEditor)
			.expect(204);

		const save = await request(app).post(base(document._id)).set(asEditor);
		expect(save.status).toBe(429);
		expect(save.body.error).toBe('Too many versions. Try again later');
		await request(app)
			.post(`${base(document._id)}/${first!._id}/restore`)
			.set(asEditor)
			.expect(429);
		// Another person is not affected (the restore changed the text, so this one is a new version), and reading is never limited
		await request(app).post(base(document._id)).set(asUser(users.owner.id)).expect(201);
		await request(app).get(base(document._id)).set(asEditor).expect(200);
	});
});
