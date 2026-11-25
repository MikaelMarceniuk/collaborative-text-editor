import type { ObjectId } from 'mongodb';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { app } from '../../app.js';
import { collections } from '../../config/mongodb.js';
import { sendShareDocumentEmail } from '../../emails/share-document.js';
import { asUser, createDocument, createUser, newUserId } from '../../test/helpers.js';

vi.mock('../middleware/auth.middleware.js', () => import('../../test/mock-auth.js'));
vi.mock('../../emails/share-document.js', () => ({
	sendShareDocumentEmail: vi.fn().mockResolvedValue(undefined),
}));

beforeEach(() => {
	vi.mocked(sendShareDocumentEmail).mockClear();
});

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

	it('emails the invited user with the document link', async () => {
		const { document, users } = await setup();
		const invited = await createUser({ name: 'Newcomer' });

		await invite(document._id, users.owner, { email: invited.email, role: 'editor' });

		expect(sendShareDocumentEmail).toHaveBeenCalledExactlyOnceWith({
			to: invited.email,
			name: 'Newcomer',
			inviterName: 'Test user',
			documentTitle: 'Test document',
			documentUrl: `http://localhost:5173/${document._id}`,
			role: 'editor',
		});
	});

	it('still adds the member when the email fails to send', async () => {
		const { document, users } = await setup();
		const invited = await createUser();
		vi.mocked(sendShareDocumentEmail).mockRejectedValueOnce(new Error('mail down'));
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

		const response = await invite(document._id, users.owner, {
			email: invited.email,
			role: 'viewer',
		});

		expect(response.status).toBe(201);
		consoleError.mockRestore();
	});

	it('does not email when the invite is rejected', async () => {
		const { document, users } = await setup();

		await invite(document._id, users.owner, { email: users.editor.email, role: 'viewer' });

		expect(sendShareDocumentEmail).not.toHaveBeenCalled();
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

describe('PATCH /api/documents/:id/members/:userId', () => {
	const changeRole = (
		documentId: ObjectId,
		as: { id: ObjectId },
		memberId: ObjectId,
		body: object,
	) =>
		request(app)
			.patch(`/api/documents/${documentId}/members/${memberId}`)
			.set(asUser(as.id))
			.send(body);

	it.each([
		['owner', 200],
		['editor', 403],
		['viewer', 403],
		['stranger', 404],
	] as const)('as %s responds %i', async (who, status) => {
		const { document, users } = await setup();

		const response = await changeRole(document._id, users[who], users.viewer.id, {
			role: 'editor',
		});

		expect(response.status).toBe(status);
	});

	it('changes the role of the member', async () => {
		const { document, users } = await setup();

		const response = await changeRole(document._id, users.owner, users.editor.id, {
			role: 'viewer',
		});

		expect(response.body.member).toEqual({
			userId: users.editor.id.toHexString(),
			role: 'viewer',
		});

		const saved = await collections.documents.findOne({ _id: document._id });
		expect(saved?.members.find((member) => member.userId.equals(users.editor.id))?.role).toBe(
			'viewer',
		);
		expect(saved?.members.find((member) => member.userId.equals(users.viewer.id))?.role).toBe(
			'viewer',
		);
	});

	it('takes effect right away: a demoted editor can no longer send updates', async () => {
		const { document, users } = await setup();
		const sendUpdate = () =>
			request(app)
				.post(`/api/documents/${document._id}/updates`)
				.set(asUser(users.editor.id))
				.set('Content-Type', 'application/octet-stream')
				.send(Buffer.from(Y.encodeStateAsUpdate(new Y.Doc())));

		expect((await sendUpdate()).status).toBe(204);

		await changeRole(document._id, users.owner, users.editor.id, { role: 'viewer' });

		expect((await sendUpdate()).status).toBe(403);
	});

	it('responds 400 when changing the owner', async () => {
		const { document, users } = await setup();

		const response = await changeRole(document._id, users.owner, users.owner.id, {
			role: 'viewer',
		});

		expect(response.status).toBe(400);
	});

	it('responds 404 for someone who is not a member', async () => {
		const { document, users } = await setup();

		const response = await changeRole(document._id, users.owner, users.stranger.id, {
			role: 'viewer',
		});

		expect(response.status).toBe(404);
	});

	it.each([
		['the owner role', { role: 'owner' }],
		['a missing role', {}],
	])('responds 400 for %s', async (_name, body) => {
		const { document, users } = await setup();

		const response = await changeRole(document._id, users.owner, users.editor.id, body);

		expect(response.status).toBe(400);
	});
});

describe('DELETE /api/documents/:id/members/:userId', () => {
	const removeMember = (documentId: ObjectId, as: { id: ObjectId }, memberId: ObjectId) =>
		request(app).delete(`/api/documents/${documentId}/members/${memberId}`).set(asUser(as.id));

	it.each([
		['owner', 204],
		['editor', 403],
		['viewer', 403],
		['stranger', 404],
	] as const)('removing another member as %s responds %i', async (who, status) => {
		const { document, users } = await setup();
		// The editor is the target, except when the editor is the one removing: then it is the viewer
		const target = who === 'editor' ? users.viewer : users.editor;

		const response = await removeMember(document._id, users[who], target.id);

		expect(response.status).toBe(status);
	});

	it.each(['editor', 'viewer'] as const)('lets the %s leave the document', async (who) => {
		const { document, users } = await setup();

		const response = await removeMember(document._id, users[who], users[who].id);

		expect(response.status).toBe(204);

		const saved = await collections.documents.findOne({ _id: document._id });
		expect(saved?.members.some((member) => member.userId.equals(users[who].id))).toBe(false);
		expect(saved?.members).toHaveLength(2);
	});

	it('cuts access right away: the removed member gets 404 on the content', async () => {
		const { document, users } = await setup();

		await removeMember(document._id, users.owner, users.viewer.id);

		const response = await request(app)
			.get(`/api/documents/${document._id}/content`)
			.set(asUser(users.viewer.id));
		expect(response.status).toBe(404);
	});

	it('responds 400 when the owner tries to leave', async () => {
		const { document, users } = await setup();

		const response = await removeMember(document._id, users.owner, users.owner.id);

		expect(response.status).toBe(400);

		const saved = await collections.documents.findOne({ _id: document._id });
		expect(saved?.members).toHaveLength(3);
	});

	it('responds 404 for someone who is not a member', async () => {
		const { document, users } = await setup();

		const response = await removeMember(document._id, users.owner, users.stranger.id);

		expect(response.status).toBe(404);
	});

	it('responds 404 for an invalid user id', async () => {
		const { document, users } = await setup();

		const response = await request(app)
			.delete(`/api/documents/${document._id}/members/nope`)
			.set(asUser(users.owner.id));

		expect(response.status).toBe(404);
	});
});
