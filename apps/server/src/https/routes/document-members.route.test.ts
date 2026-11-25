import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { app } from '../../app.js';
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
