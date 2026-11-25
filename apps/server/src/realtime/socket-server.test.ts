import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { ObjectId } from 'mongodb';
import { io as connect, type Socket } from 'socket.io-client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { applyDocumentUpdate, loadDocumentState } from '../services/document-content.service.js';
import { asUser, createDocument, createUser } from '../test/helpers.js';
import { accessNotifier } from './access-notifier.js';
import { createSocketServer, SOCKET_PATH } from './socket-server.js';

vi.mock('./socket-session.js', () => import('../test/mock-socket-session.js'));

let httpServer: HttpServer | undefined;
let socketServer: ReturnType<typeof createSocketServer> | undefined;
const clients: Socket[] = [];

const startServer = async () => {
	httpServer = createServer();
	socketServer = createSocketServer(httpServer);
	await new Promise<void>((resolve) => httpServer!.listen(0, resolve));
	return `http://localhost:${(httpServer.address() as AddressInfo).port}`;
};

afterEach(async () => {
	for (const client of clients.splice(0)) client.disconnect();
	await socketServer?.close();
	httpServer = socketServer = undefined;
});

interface ConnectOptions {
	url: string;
	documentId: string;
	userId?: ObjectId;
}

// Resolves with the socket once connected, or with the error message of connect_error
const connectToDocument = ({ url, documentId, userId }: ConnectOptions) =>
	new Promise<{ socket: Socket; error?: string }>((resolve) => {
		const socket = connect(url, {
			path: SOCKET_PATH,
			transports: ['websocket'],
			reconnection: false,
			auth: { documentId },
			extraHeaders: userId ? asUser(userId) : {},
		});
		clients.push(socket);
		socket.on('connect', () => resolve({ socket }));
		socket.on('connect_error', (error) => resolve({ socket, error: error.message }));
	});

describe('socket authentication', () => {
	it('connects a member', async () => {
		const owner = await createUser();
		const document = await createDocument({ ownerId: owner.id });
		const url = await startServer();

		const { socket, error } = await connectToDocument({
			url,
			documentId: document._id.toHexString(),
			userId: owner.id,
		});

		expect(error).toBeUndefined();
		expect(socket.connected).toBe(true);
	});

	it('rejects a connection without a session', async () => {
		const owner = await createUser();
		const document = await createDocument({ ownerId: owner.id });
		const url = await startServer();

		const { error } = await connectToDocument({ url, documentId: document._id.toHexString() });

		expect(error).toBe('unauthorized');
	});

	it('answers not_found to someone who is not a member', async () => {
		const [owner, stranger] = await Promise.all([createUser(), createUser()]);
		const document = await createDocument({ ownerId: owner.id });
		const url = await startServer();

		const { error } = await connectToDocument({
			url,
			documentId: document._id.toHexString(),
			userId: stranger.id,
		});

		expect(error).toBe('not_found');
	});

	it('answers not_found to an invalid document id', async () => {
		const owner = await createUser();
		const url = await startServer();

		const { error } = await connectToDocument({
			url,
			documentId: 'not-an-id',
			userId: owner.id,
		});

		expect(error).toBe('not_found');
	});
});

const textUpdate = (text: string) => {
	const ydoc = new Y.Doc();
	ydoc.getText('t').insert(0, text);
	return Y.encodeStateAsUpdate(ydoc);
};

const readText = (update: Uint8Array) => {
	const ydoc = new Y.Doc();
	Y.applyUpdate(ydoc, update);
	return ydoc.getText('t').toString();
};

// Resolves with the next doc:update the socket receives
const nextUpdate = (socket: Socket) =>
	new Promise<Uint8Array>((resolve) => socket.once('doc:update', resolve));

// Waits long enough for a message that should NOT arrive to show up
const noUpdateWithin = async (socket: Socket, ms = 150) => {
	const received = vi.fn();
	socket.on('doc:update', received);
	await new Promise((resolve) => setTimeout(resolve, ms));
	socket.off('doc:update', received);
	return received.mock.calls.length === 0;
};

const emptyStateVector = () => Y.encodeStateVector(new Y.Doc());

const setupMembers = async () => {
	const [owner, editor, viewer] = await Promise.all([createUser(), createUser(), createUser()]);
	const document = await createDocument({
		ownerId: owner.id,
		members: [
			{ userId: editor.id, role: 'editor' },
			{ userId: viewer.id, role: 'viewer' },
		],
	});
	const url = await startServer();
	const open = async (user: { id: ObjectId }) => {
		const { socket } = await connectToDocument({
			url,
			documentId: document._id.toHexString(),
			userId: user.id,
		});
		return socket;
	};

	return { document, owner, editor, viewer, open, url };
};

describe('document sync', () => {
	it('answers doc:sync with the role and the saved state', async () => {
		const { document, viewer, open } = await setupMembers();
		await applyDocumentUpdate({ documentId: document._id, update: textUpdate('saved') });
		const socket = await open(viewer);

		const response = await socket.emitWithAck('doc:sync', emptyStateVector());

		expect(response.ok).toBe(true);
		expect(response.role).toBe('viewer');
		expect(readText(response.update)).toBe('saved');
	});

	it('relays an update to the other clients, but not back to the sender', async () => {
		const { owner, editor, viewer, open } = await setupMembers();
		const [ownerSocket, editorSocket, viewerSocket] = await Promise.all([
			open(owner),
			open(editor),
			open(viewer),
		]);
		await Promise.all(
			[ownerSocket, editorSocket, viewerSocket].map((socket) =>
				socket.emitWithAck('doc:sync', emptyStateVector()),
			),
		);

		const ownerReceives = nextUpdate(ownerSocket);
		const viewerReceives = nextUpdate(viewerSocket);
		const editorGetsEcho = noUpdateWithin(editorSocket);
		const response = await editorSocket.emitWithAck('doc:update', textUpdate('hello'));

		expect(response).toEqual({ ok: true });
		expect(readText(await ownerReceives)).toBe('hello');
		expect(readText(await viewerReceives)).toBe('hello');
		expect(await editorGetsEcho).toBe(true);
	});

	it('gives a late joiner what happened before it joined', async () => {
		const { owner, editor, open } = await setupMembers();
		const ownerSocket = await open(owner);
		await ownerSocket.emitWithAck('doc:update', textUpdate('before'));

		const editorSocket = await open(editor);
		const response = await editorSocket.emitWithAck('doc:sync', emptyStateVector());

		expect(readText(response.update)).toBe('before');
	});

	it('rejects an update from a viewer and relays nothing', async () => {
		const { owner, viewer, open } = await setupMembers();
		const [ownerSocket, viewerSocket] = await Promise.all([open(owner), open(viewer)]);
		const ownerGetsNothing = noUpdateWithin(ownerSocket);

		const response = await viewerSocket.emitWithAck('doc:update', textUpdate('nope'));

		expect(response).toEqual({ ok: false, error: 'forbidden' });
		expect(await ownerGetsNothing).toBe(true);
		const state = await ownerSocket.emitWithAck('doc:sync', emptyStateVector());
		expect(readText(state.update)).toBe('');
	});

	it('rejects an invalid update without relaying it or breaking the room', async () => {
		const { owner, editor, open } = await setupMembers();
		const [ownerSocket, editorSocket] = await Promise.all([open(owner), open(editor)]);
		const ownerGetsNothing = noUpdateWithin(ownerSocket);

		const garbage = await editorSocket.emitWithAck('doc:update', new Uint8Array([255, 255, 255]));
		const notBytes = await editorSocket.emitWithAck('doc:update', 'text');

		expect(garbage).toEqual({ ok: false, error: 'invalid' });
		expect(notBytes).toEqual({ ok: false, error: 'invalid' });
		expect(await ownerGetsNothing).toBe(true);

		const valid = await editorSocket.emitWithAck('doc:update', textUpdate('still works'));
		expect(valid).toEqual({ ok: true });
	});

	it('converges a client that edited while offline', async () => {
		const { owner, editor, open } = await setupMembers();
		const ownerSocket = await open(owner);
		await ownerSocket.emitWithAck('doc:update', textUpdate('server'));

		// The editor has its own edit that the server never saw
		const offlineDoc = new Y.Doc();
		offlineDoc.getText('t').insert(0, 'offline');
		const editorSocket = await open(editor);
		const response = await editorSocket.emitWithAck('doc:sync', Y.encodeStateVector(offlineDoc));
		Y.applyUpdate(offlineDoc, response.update);
		const ownerReceives = nextUpdate(ownerSocket);
		await editorSocket.emitWithAck(
			'doc:update',
			Y.encodeStateAsUpdate(offlineDoc, response.stateVector),
		);

		const ownerDoc = new Y.Doc();
		Y.applyUpdate(ownerDoc, (await ownerSocket.emitWithAck('doc:sync', emptyStateVector())).update);
		await ownerReceives;
		expect(ownerDoc.getText('t').toString()).toBe(offlineDoc.getText('t').toString());
		expect(ownerDoc.getText('t').toString()).toContain('server');
		expect(ownerDoc.getText('t').toString()).toContain('offline');
	});
});

describe('persistence over the socket', () => {
	it('saves the document when the last client disconnects', async () => {
		const { document, owner, open } = await setupMembers();
		const socket = await open(owner);
		await socket.emitWithAck('doc:update', textUpdate('persisted'));

		socket.disconnect();

		// The save runs after the disconnect, so poll until it lands
		await vi.waitFor(async () => {
			const stored = new Y.Doc();
			Y.applyUpdate(stored, await loadDocumentState(document._id));
			expect(stored.getText('t').toString()).toBe('persisted');
		});
	});

	it('saves what the rooms hold when the server closes', async () => {
		const { document, owner, open } = await setupMembers();
		const socket = await open(owner);
		await socket.emitWithAck('doc:update', textUpdate('on shutdown'));

		await socketServer!.close();

		const stored = new Y.Doc();
		Y.applyUpdate(stored, await loadDocumentState(document._id));
		expect(stored.getText('t').toString()).toBe('on shutdown');
	});
});

// Resolves with the payload of the next `event` the socket receives
const nextEvent = <T>(socket: Socket, event: string) =>
	new Promise<T>((resolve) => socket.once(event, resolve));

// Waits long enough for an event that should NOT arrive to show up
const noEventWithin = async (socket: Socket, event: string, ms = 150) => {
	const received = vi.fn();
	socket.on(event, received);
	await new Promise((resolve) => setTimeout(resolve, ms));
	socket.off(event, received);
	return received.mock.calls.length === 0;
};

describe('document awareness', () => {
	const presence = (clientId: number, text = 'cursor') => ({
		clientId,
		update: new TextEncoder().encode(text),
	});

	// A socket that has finished joining the room, so it receives what the others send
	const joinedSockets = async (
		open: (user: { id: ObjectId }) => Promise<Socket>,
		users: { id: ObjectId }[],
	) => {
		const sockets = await Promise.all(users.map(open));
		await Promise.all(sockets.map((socket) => socket.emitWithAck('doc:sync', emptyStateVector())));
		return sockets;
	};

	it('relays the presence to the other clients, but not back to the sender', async () => {
		const { owner, editor, viewer, open } = await setupMembers();
		const [ownerSocket, editorSocket, viewerSocket] = await joinedSockets(open, [
			owner,
			editor,
			viewer,
		]);

		const ownerReceives = nextEvent<{ clientId: number; update: Uint8Array }>(
			ownerSocket,
			'awareness:update',
		);
		const viewerReceives = nextEvent<{ clientId: number; update: Uint8Array }>(
			viewerSocket,
			'awareness:update',
		);
		const editorGetsEcho = noEventWithin(editorSocket, 'awareness:update');
		editorSocket.emit('awareness:update', presence(1, 'hello'));

		for (const received of [await ownerReceives, await viewerReceives]) {
			expect(received.clientId).toBe(1);
			expect(new TextDecoder().decode(received.update)).toBe('hello');
		}
		expect(await editorGetsEcho).toBe(true);
	});

	it('lets a viewer send its presence', async () => {
		const { owner, viewer, open } = await setupMembers();
		const [ownerSocket, viewerSocket] = await joinedSockets(open, [owner, viewer]);

		const ownerReceives = nextEvent<{ clientId: number }>(ownerSocket, 'awareness:update');
		viewerSocket.emit('awareness:update', presence(7));

		expect((await ownerReceives).clientId).toBe(7);
	});

	it('ignores malformed presence and keeps the connection', async () => {
		const { owner, editor, open } = await setupMembers();
		const [ownerSocket, editorSocket] = await joinedSockets(open, [owner, editor]);

		const nothingArrives = noEventWithin(ownerSocket, 'awareness:update');
		editorSocket.emit('awareness:update', 'nope');
		editorSocket.emit('awareness:update', { clientId: 'x', update: new Uint8Array(1) });
		editorSocket.emit('awareness:update', { clientId: 1.5, update: new Uint8Array(1) });
		editorSocket.emit('awareness:update', { clientId: 1, update: 'not bytes' });
		editorSocket.emit('awareness:update');

		expect(await nothingArrives).toBe(true);
		expect(editorSocket.connected).toBe(true);
	});

	it('keeps a socket to the first client id it used', async () => {
		const { owner, editor, open } = await setupMembers();
		const [ownerSocket, editorSocket] = await joinedSockets(open, [owner, editor]);

		const first = nextEvent<{ clientId: number }>(ownerSocket, 'awareness:update');
		editorSocket.emit('awareness:update', presence(1));
		expect((await first).clientId).toBe(1);

		const impersonation = noEventWithin(ownerSocket, 'awareness:update');
		editorSocket.emit('awareness:update', presence(2));
		expect(await impersonation).toBe(true);
	});

	it('relays a query to the others, but not back to the sender', async () => {
		const { owner, editor, open } = await setupMembers();
		const [ownerSocket, editorSocket] = await joinedSockets(open, [owner, editor]);

		const ownerReceives = nextEvent<undefined>(ownerSocket, 'awareness:query');
		const editorGetsEcho = noEventWithin(editorSocket, 'awareness:query');
		editorSocket.emit('awareness:query');

		await ownerReceives;
		expect(await editorGetsEcho).toBe(true);
	});

	it('does not relay presence to another document', async () => {
		const { owner, editor, open, url } = await setupMembers();
		const [, editorSocket] = await joinedSockets(open, [owner, editor]);
		const other = await createDocument({ ownerId: owner.id });
		const { socket: otherSocket } = await connectToDocument({
			url,
			documentId: other._id.toHexString(),
			userId: owner.id,
		});
		await otherSocket.emitWithAck('doc:sync', emptyStateVector());

		const leaks = noEventWithin(otherSocket, 'awareness:update');
		editorSocket.emit('awareness:update', presence(1));

		expect(await leaks).toBe(true);
	});
});

describe('document awareness on disconnect', () => {
	const sendPresence = (socket: Socket, clientId: number) =>
		socket.emit('awareness:update', { clientId, update: new Uint8Array(1) });

	it('tells the others which client left', async () => {
		const { owner, editor, open } = await setupMembers();
		const [ownerSocket, editorSocket] = await Promise.all([open(owner), open(editor)]);
		await Promise.all(
			[ownerSocket, editorSocket].map((socket) =>
				socket.emitWithAck('doc:sync', emptyStateVector()),
			),
		);
		sendPresence(editorSocket, 42);
		await new Promise((resolve) => setTimeout(resolve, 50));

		const left = nextEvent<number>(ownerSocket, 'awareness:left');
		editorSocket.disconnect();

		expect(await left).toBe(42);
	});

	it('relays nothing that arrives after the socket disconnected', async () => {
		const { owner, editor, open } = await setupMembers();
		const [ownerSocket, editorSocket] = await Promise.all([open(owner), open(editor)]);
		await Promise.all(
			[ownerSocket, editorSocket].map((socket) =>
				socket.emitWithAck('doc:sync', emptyStateVector()),
			),
		);

		const nothingArrives = noEventWithin(ownerSocket, 'awareness:update');
		sendPresence(editorSocket, 9);
		editorSocket.disconnect();

		expect(await nothingArrives).toBe(true);
	});

	it('says nothing when the socket never sent presence', async () => {
		const { owner, editor, open } = await setupMembers();
		const [ownerSocket, editorSocket] = await Promise.all([open(owner), open(editor)]);
		await Promise.all(
			[ownerSocket, editorSocket].map((socket) =>
				socket.emitWithAck('doc:sync', emptyStateVector()),
			),
		);

		const silence = noEventWithin(ownerSocket, 'awareness:left');
		editorSocket.disconnect();

		expect(await silence).toBe(true);
	});

	it('tells the others when the server drops a member whose access changed', async () => {
		const { document, owner, editor, open } = await setupMembers();
		const [ownerSocket, editorSocket] = await Promise.all([open(owner), open(editor)]);
		await Promise.all(
			[ownerSocket, editorSocket].map((socket) =>
				socket.emitWithAck('doc:sync', emptyStateVector()),
			),
		);
		sendPresence(editorSocket, 5);
		await new Promise((resolve) => setTimeout(resolve, 50));

		const left = nextEvent<number>(ownerSocket, 'awareness:left');
		// What the member routes call after a role change or a removal: it disconnects that member's sockets
		await accessNotifier.memberChanged(document._id, editor.id);

		expect(await left).toBe(5);
	});
});
