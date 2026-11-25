import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { ObjectId } from 'mongodb';
import { io as connect, type Socket } from 'socket.io-client';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { app } from '../app.js';
import { collections } from '../config/mongodb.js';
import { asUser, createDocument, createUser } from '../test/helpers.js';
import { createSocketServer, SOCKET_PATH } from './socket-server.js';

vi.mock('../https/middleware/auth.middleware.js', () => import('../test/mock-auth.js'));
vi.mock('./socket-session.js', () => import('../test/mock-socket-session.js'));

let httpServer: HttpServer | undefined;
let socketServer: ReturnType<typeof createSocketServer> | undefined;
const clients: Socket[] = [];

afterEach(async () => {
	for (const client of clients.splice(0)) client.disconnect();
	await socketServer?.close();
	httpServer = socketServer = undefined;
});

const setup = async () => {
	const [owner, editor, other] = await Promise.all([createUser(), createUser(), createUser()]);
	const document = await createDocument({
		ownerId: owner.id,
		members: [
			{ userId: editor.id, role: 'editor' },
			{ userId: other.id, role: 'editor' },
		],
	});

	httpServer = createServer();
	socketServer = createSocketServer(httpServer);
	await new Promise<void>((resolve) => httpServer!.listen(0, resolve));
	const url = `http://localhost:${(httpServer.address() as AddressInfo).port}`;

	// Resolves once connected, with the reasons the server gave for disconnecting
	const open = async (user: { id: ObjectId }) => {
		const socket = connect(url, {
			path: SOCKET_PATH,
			transports: ['websocket'],
			reconnection: false,
			auth: { documentId: document._id.toHexString() },
			extraHeaders: asUser(user.id),
		});
		clients.push(socket);
		const events: string[] = [];
		socket.on('doc:access-changed', () => events.push('access-changed'));
		socket.on('disconnect', (reason) => events.push(`disconnect:${reason}`));
		await new Promise<void>((resolve) => socket.once('connect', resolve));
		return { socket, events };
	};

	return { document, owner, editor, other, open };
};

describe('access changes with open sockets', () => {
	it('disconnects only the member whose role changed, and the new role applies on reconnect', async () => {
		const { document, owner, editor, other, open } = await setup();
		const [editorConnection, otherConnection] = await Promise.all([open(editor), open(other)]);

		await request(app)
			.patch(`/api/documents/${document._id}/members/${editor.id}`)
			.set(asUser(owner.id))
			.send({ role: 'viewer' })
			.expect(200);

		await vi.waitFor(() =>
			expect(editorConnection.events).toEqual([
				'access-changed',
				'disconnect:io server disconnect',
			]),
		);
		expect(otherConnection.events).toEqual([]);

		// The client reconnects and the handshake reads the new role
		const reconnected = await open(editor);
		const sync = await reconnected.socket.emitWithAck('doc:sync', Y.encodeStateVector(new Y.Doc()));
		expect(sync.role).toBe('viewer');
		const update = await reconnected.socket.emitWithAck('doc:update', new Uint8Array());
		expect(update).toEqual({ ok: false, error: 'forbidden' });
	});

	it('disconnects a removed member and refuses them back', async () => {
		const { document, owner, editor, open } = await setup();
		const { events } = await open(editor);

		await request(app)
			.delete(`/api/documents/${document._id}/members/${editor.id}`)
			.set(asUser(owner.id))
			.expect(204);

		await vi.waitFor(() =>
			expect(events).toEqual(['access-changed', 'disconnect:io server disconnect']),
		);
		const retry = connect(`http://localhost:${(httpServer!.address() as AddressInfo).port}`, {
			path: SOCKET_PATH,
			transports: ['websocket'],
			reconnection: false,
			auth: { documentId: document._id.toHexString() },
			extraHeaders: asUser(editor.id),
		});
		clients.push(retry);
		const error = await new Promise<string>((resolve) =>
			retry.once('connect_error', (e) => resolve(e.message)),
		);
		expect(error).toBe('not_found');
	});

	it('disconnects a member who leaves on their own', async () => {
		const { document, editor, open } = await setup();
		const { events } = await open(editor);

		await request(app)
			.delete(`/api/documents/${document._id}/members/${editor.id}`)
			.set(asUser(editor.id))
			.expect(204);

		await vi.waitFor(() =>
			expect(events).toEqual(['access-changed', 'disconnect:io server disconnect']),
		);
	});

	it('disconnects everyone when the document is deleted, without bringing it back', async () => {
		const { document, owner, editor, open } = await setup();
		const [ownerConnection, editorConnection] = await Promise.all([open(owner), open(editor)]);
		const edit = new Y.Doc();
		edit.getText('t').insert(0, 'unsaved');
		await editorConnection.socket.emitWithAck('doc:update', Y.encodeStateAsUpdate(edit));

		await request(app).delete(`/api/documents/${document._id}`).set(asUser(owner.id)).expect(204);

		await vi.waitFor(() => {
			expect(ownerConnection.events).toEqual(['access-changed', 'disconnect:io server disconnect']);
			expect(editorConnection.events).toEqual([
				'access-changed',
				'disconnect:io server disconnect',
			]);
		});
		await socketServer!.close();
		expect(await collections.documents.countDocuments({ _id: document._id })).toBe(0);
	});
});
