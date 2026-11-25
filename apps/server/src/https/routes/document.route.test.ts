import { ObjectId } from 'mongodb';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { app } from '../../app.js';
import { collections } from '../../config/mongodb.js';
import { asUser, createDocument, newUserId } from '../../test/helpers.js';

vi.mock('../middleware/auth.middleware.js', () => import('../../test/mock-auth.js'));

// One document with an owner, an editor and a viewer, and a user outside it
const setup = async () => {
	const [owner, editor, viewer, stranger] = [newUserId(), newUserId(), newUserId(), newUserId()];
	const document = await createDocument({
		ownerId: owner,
		members: [
			{ userId: editor, role: 'editor' },
			{ userId: viewer, role: 'viewer' },
		],
	});

	return { document, users: { owner, editor, viewer, stranger } };
};

describe('authentication', () => {
	it('rejects requests without a session', async () => {
		const response = await request(app).get('/api/documents');

		expect(response.status).toBe(401);
	});
});

describe('POST /api/documents', () => {
	it('creates a document owned by the current user', async () => {
		const owner = newUserId();

		const response = await request(app).post('/api/documents').set(asUser(owner));

		expect(response.status).toBe(201);
		expect(response.body.document.ownerId).toBe(owner.toHexString());
		expect(response.body.document.members).toEqual([
			{ userId: owner.toHexString(), role: 'owner' },
		]);
	});
});

describe('GET /api/documents', () => {
	it('lists only the documents the user is a member of', async () => {
		const { document, users } = await setup();
		await createDocument({ ownerId: users.stranger });

		const response = await request(app).get('/api/documents').set(asUser(users.viewer));

		expect(response.status).toBe(200);
		expect(response.body.documents.map((d: { _id: string }) => d._id)).toEqual([
			document._id.toHexString(),
		]);
	});
});

describe('GET /api/documents/:id', () => {
	it.each([
		['owner', 200],
		['editor', 200],
		['viewer', 200],
		['stranger', 404],
	] as const)('as %s responds %i', async (who, status) => {
		const { document, users } = await setup();

		const response = await request(app)
			.get(`/api/documents/${document._id}`)
			.set(asUser(users[who]));

		expect(response.status).toBe(status);
	});

	it('responds 404 for an invalid id', async () => {
		const response = await request(app).get('/api/documents/nope').set(asUser(newUserId()));

		expect(response.status).toBe(404);
	});
});

describe('PATCH /api/documents/:id', () => {
	it.each([
		['owner', 200],
		['editor', 200],
		['viewer', 403],
		['stranger', 404],
	] as const)('as %s responds %i', async (who, status) => {
		const { document, users } = await setup();

		const response = await request(app)
			.patch(`/api/documents/${document._id}`)
			.set(asUser(users[who]))
			.send({ title: 'Renamed' });

		expect(response.status).toBe(status);
	});

	it('responds 400 for an empty title', async () => {
		const { document, users } = await setup();

		const response = await request(app)
			.patch(`/api/documents/${document._id}`)
			.set(asUser(users.owner))
			.send({ title: '   ' });

		expect(response.status).toBe(400);
	});
});

describe('DELETE /api/documents/:id', () => {
	it.each([
		['owner', 204],
		['editor', 403],
		['viewer', 403],
		['stranger', 404],
	] as const)('as %s responds %i', async (who, status) => {
		const { document, users } = await setup();

		const response = await request(app)
			.delete(`/api/documents/${document._id}`)
			.set(asUser(users[who]));

		expect(response.status).toBe(status);
	});

	it('removes the document when the owner deletes it', async () => {
		const { document, users } = await setup();

		await request(app).delete(`/api/documents/${document._id}`).set(asUser(users.owner));

		expect(await collections.documents.findOne({ _id: new ObjectId(document._id) })).toBeNull();
	});
});
