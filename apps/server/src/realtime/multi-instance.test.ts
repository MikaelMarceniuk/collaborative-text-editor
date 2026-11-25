import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { ObjectId } from 'mongodb';
import { io as connect, type Socket } from 'socket.io-client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { connectToRedis } from '../config/redis.js';
import { asUser, createDocument, createUser } from '../test/helpers.js';
import { testRedisUrl } from '../test/redis.js';
import { createSocketServer, SOCKET_PATH } from './socket-server.js';

vi.mock('./socket-session.js', () => import('../test/mock-socket-session.js'));

/**
 * Two server instances in one process, sharing Redis and Mongo like two machines would.
 * Only runs with TEST_REDIS_URL (the CI sets it).
 */
interface Instance {
	url: string;
	socketServer: ReturnType<typeof createSocketServer>;
	stop: () => Promise<void>;
}

const instances: Instance[] = [];
const clients: Socket[] = [];

const startInstance = async (): Promise<Instance> => {
	const redis = await connectToRedis(testRedisUrl!);
	const httpServer: HttpServer = createServer();
	const socketServer = createSocketServer(httpServer, { redis });
	await new Promise<void>((resolve) => httpServer.listen(0, resolve));

	const instance: Instance = {
		url: `http://localhost:${(httpServer.address() as AddressInfo).port}`,
		socketServer,
		stop: async () => {
			await socketServer.close();
			await redis.close();
		},
	};
	instances.push(instance);
	return instance;
};

afterEach(async () => {
	for (const client of clients.splice(0)) client.disconnect();
	await Promise.all(instances.splice(0).map((instance) => instance.stop()));
});

const openDocument = async (instance: Instance, documentId: ObjectId, userId: ObjectId) => {
	const socket = connect(instance.url, {
		path: SOCKET_PATH,
		transports: ['websocket'],
		reconnection: false,
		auth: { documentId: documentId.toHexString() },
		extraHeaders: asUser(userId),
	});
	clients.push(socket);
	await new Promise<void>((resolve, reject) => {
		socket.on('connect', resolve);
		socket.on('connect_error', reject);
	});
	return socket;
};

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

const emptyStateVector = () => Y.encodeStateVector(new Y.Doc());

const nextEvent = <T>(socket: Socket, event: string) =>
	new Promise<T>((resolve) => socket.once(event, resolve));

// Two members of one document, each with a socket on a different instance, both already synced
const setupTwoInstances = async () => {
	const [owner, editor] = await Promise.all([createUser(), createUser()]);
	const document = await createDocument({
		ownerId: owner.id,
		members: [{ userId: editor.id, role: 'editor' }],
	});
	const [instanceA, instanceB] = [await startInstance(), await startInstance()];
	const [socketA, socketB] = await Promise.all([
		openDocument(instanceA, document._id, owner.id),
		openDocument(instanceB, document._id, editor.id),
	]);
	await Promise.all(
		[socketA, socketB].map((socket) => socket.emitWithAck('doc:sync', emptyStateVector())),
	);

	return { document, owner, editor, instanceA, instanceB, socketA, socketB };
};

describe.skipIf(!testRedisUrl)('document sockets across instances', () => {
	it('relays an update to a client on another instance', async () => {
		const { socketA, socketB } = await setupTwoInstances();

		const received = nextEvent<Uint8Array>(socketB, 'doc:update');
		const response = await socketA.emitWithAck('doc:update', textUpdate('from A'));

		expect(response).toEqual({ ok: true });
		expect(readText(await received)).toBe('from A');
	});

	it('relays the presence to another instance, after the update sent before it', async () => {
		const { socketA, socketB } = await setupTwoInstances();

		const order: string[] = [];
		socketB.on('doc:update', () => order.push('update'));
		socketB.on('awareness:update', () => order.push('presence'));
		socketA.emit('doc:update', textUpdate('hello'));
		socketA.emit('awareness:update', { clientId: 1, update: new Uint8Array([1]) });

		await vi.waitFor(() => expect(order).toHaveLength(2));
		expect(order).toEqual(['update', 'presence']);
	});

	it('tells the other instance which client left', async () => {
		const { socketA, socketB } = await setupTwoInstances();
		socketA.emit('awareness:update', { clientId: 7, update: new Uint8Array([1]) });
		await new Promise((resolve) => setTimeout(resolve, 100));

		const left = nextEvent<number>(socketB, 'awareness:left');
		socketA.disconnect();

		expect(await left).toBe(7);
	});
});
