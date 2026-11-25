import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { ObjectId } from 'mongodb';
import { io as connect, type Socket } from 'socket.io-client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { asUser, createDocument, createUser } from '../test/helpers.js';
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
