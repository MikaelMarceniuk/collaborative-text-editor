import type { ObjectId } from 'mongodb';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { app } from '../../app.js';
import { collections } from '../../config/mongodb.js';
import { asUser, createDocument, createUser, newUserId } from '../../test/helpers.js';

vi.mock('../middleware/auth.middleware.js', () => import('../../test/mock-auth.js'));

// A document with an owner, an editor and a viewer, plus a user outside it
const setup = async () => {
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

	return { document, users: { owner, editor, viewer, stranger } };
};

describe('GET /api/documents/:id/members', () => {
	it.each([
		['owner', 200],
		['editor', 200],
		['viewer', 200],
		['stranger', 404],
	] as const)('as %s responds %i', async (who, status) => {
		const { document, users } = await setup();

		const response = await request(app)
			.get(`/api/documents/${document._id}/members`)
			.set(asUser(users[who].id));

		expect(response.status).toBe(status);
	});

	it('lists the members with name, email and role, owner first', async () => {
		const { document, users } = await setup();

		const response = await request(app)
			.get(`/api/documents/${document._id}/members`)
			.set(asUser(users.viewer.id));

		expect(response.body.members).toEqual([
			{
				userId: users.owner.id.toHexString(),
				role: 'owner',
				name: 'Olivia Owner',
				email: users.owner.email,
			},
			{
				userId: users.editor.id.toHexString(),
				role: 'editor',
				name: 'Eddie Editor',
				email: users.editor.email,
			},
			{
				userId: users.viewer.id.toHexString(),
				role: 'viewer',
				name: 'Vera Viewer',
				email: users.viewer.email,
			},
		]);
	});

	it('responds 404 for an unknown document', async () => {
		const response = await request(app)
			.get(`/api/documents/${newUserId()}/members`)
			.set(asUser(newUserId()));

		expect(response.status).toBe(404);
	});
});

describe('POST /api/documents/:id/members', () => {
	const invite = (documentId: ObjectId, as: { id: ObjectId }, body: object) =>
		request(app).post(`/api/documents/${documentId}/members`).set(asUser(as.id)).send(body);

	it.each([
		['owner', 201],
		['editor', 403],
		['viewer', 403],
		['stranger', 404],
	] as const)('as %s responds %i', async (who, status) => {
		const { document, users } = await setup();
		const invited = await createUser({ name: 'Newcomer' });

		const response = await invite(document._id, users[who], {
			email: invited.email,
			role: 'viewer',
		});

		expect(response.status).toBe(status);
	});

	it('adds the user with the chosen role and returns the member', async () => {
		const { document, users } = await setup();
		const invited = await createUser({ name: 'Newcomer' });

		const response = await invite(document._id, users.owner, {
			email: invited.email,
			role: 'editor',
		});

		expect(response.body.member).toEqual({
			userId: invited.id.toHexString(),
			role: 'editor',
			name: 'Newcomer',
			email: invited.email,
		});

		const saved = await collections.documents.findOne({ _id: document._id });
		expect(saved?.members).toContainEqual({ userId: invited.id, role: 'editor' });
	});

	it('makes the document show up in the invited user list', async () => {
		const { document, users } = await setup();
		const invited = await createUser();

		await invite(document._id, users.owner, { email: invited.email, role: 'viewer' });

		const response = await request(app).get('/api/documents').set(asUser(invited.id));
		expect(response.body.documents.map((d: { _id: string }) => d._id)).toEqual([
			document._id.toHexString(),
		]);
	});

	it('ignores case and spaces in the email', async () => {
		const { document, users } = await setup();
		const invited = await createUser({ email: 'mixed@test.local' });

		const response = await invite(document._id, users.owner, {
			email: '  Mixed@Test.Local ',
			role: 'viewer',
		});

		expect(response.status).toBe(201);
		expect(response.body.member.userId).toBe(invited.id.toHexString());
	});

	it('responds 404 when no user has the email', async () => {
		const { document, users } = await setup();

		const response = await invite(document._id, users.owner, {
			email: 'nobody@test.local',
			role: 'viewer',
		});

		expect(response.status).toBe(404);
	});

	it('responds 409 when the user is already a member', async () => {
		const { document, users } = await setup();

		const response = await invite(document._id, users.owner, {
			email: users.editor.email,
			role: 'viewer',
		});

		expect(response.status).toBe(409);
	});

	it('adds only once when the same invite arrives twice at the same time', async () => {
		const { document, users } = await setup();
		const invited = await createUser();
		const body = { email: invited.email, role: 'viewer' };

		const responses = await Promise.all([
			invite(document._id, users.owner, body),
			invite(document._id, users.owner, body),
		]);

		expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);

		const saved = await collections.documents.findOne({ _id: document._id });
		expect(saved?.members.filter((member) => member.userId.equals(invited.id))).toHaveLength(1);
	});

	it('responds 403 when the owner is a guest', async () => {
		const guest = await createUser({ isAnonymous: true });
		const document = await createDocument({ ownerId: guest.id });
		const invited = await createUser();

		const response = await request(app)
			.post(`/api/documents/${document._id}/members`)
			.set(asUser(guest.id, { guest: true }))
			.send({ email: invited.email, role: 'viewer' });

		expect(response.status).toBe(403);
	});

	it('responds 400 when inviting a guest', async () => {
		const { document, users } = await setup();
		const guest = await createUser({ isAnonymous: true });

		const response = await invite(document._id, users.owner, {
			email: guest.email,
			role: 'viewer',
		});

		expect(response.status).toBe(400);
	});

	it('responds 400 when the owner invites themself', async () => {
		const { document, users } = await setup();

		const response = await invite(document._id, users.owner, {
			email: users.owner.email,
			role: 'editor',
		});

		expect(response.status).toBe(400);
	});

	it.each([
		['an invalid email', { email: 'not-an-email', role: 'viewer' }],
		['a missing role', { email: 'a@test.local' }],
		['the owner role', { email: 'a@test.local', role: 'owner' }],
		['an unknown role', { email: 'a@test.local', role: 'admin' }],
	])('responds 400 for %s', async (_name, body) => {
		const { document, users } = await setup();

		const response = await invite(document._id, users.owner, body);

		expect(response.status).toBe(400);
	});
});
