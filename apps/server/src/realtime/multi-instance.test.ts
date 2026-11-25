import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { ObjectId } from 'mongodb';
import { createClient } from 'redis';
import { io as connect, type Socket } from 'socket.io-client';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { app } from '../app.js';
import { collections } from '../config/mongodb.js';
import { connectToRedis } from '../config/redis.js';
import * as contentService from '../services/document-content.service.js';
import { loadDocumentState } from '../services/document-content.service.js';
import { asUser, createDocument, createUser } from '../test/helpers.js';
import { testRedisUrl } from '../test/redis.js';
import { createSocketServer, SOCKET_PATH } from './socket-server.js';

vi.mock('../https/middleware/auth.middleware.js', () => import('../test/mock-auth.js'));
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

describe.skipIf(!testRedisUrl)('document rooms across instances', () => {
	it('gives a client that opens the document on another instance the edits that are not saved yet', async () => {
		const [owner, editor] = await Promise.all([createUser(), createUser()]);
		const document = await createDocument({
			ownerId: owner.id,
			members: [{ userId: editor.id, role: 'editor' }],
		});
		const [instanceA, instanceB] = [await startInstance(), await startInstance()];
		const socketA = await openDocument(instanceA, document._id, owner.id);
		await socketA.emitWithAck('doc:sync', emptyStateVector());
		await socketA.emitWithAck('doc:update', textUpdate('not saved yet'));
		// The save waits 2s after the last update, so Mongo does not have it
		expect(readText(await loadDocumentState(document._id))).toBe('');

		const socketB = await openDocument(instanceB, document._id, editor.id);
		const response = await socketB.emitWithAck('doc:sync', emptyStateVector());

		expect(readText(response.update)).toBe('not saved yet');
	});

	it('keeps the room of another instance up to date, for whoever joins it later', async () => {
		const { document, instanceB, socketA } = await setupTwoInstances();
		const third = await createUser();
		await collections.documents.updateOne(
			{ _id: document._id },
			{ $push: { members: { userId: third.id, role: 'viewer' } } },
		);

		await socketA.emitWithAck('doc:update', textUpdate('edited on A'));
		expect(readText(await loadDocumentState(document._id))).toBe('');

		// The room of instance B was open before the edit, so it only gets it through the other instance
		const socketC = await openDocument(instanceB, document._id, third.id);
		const response = await socketC.emitWithAck('doc:sync', emptyStateVector());

		expect(readText(response.update)).toBe('edited on A');
	});

	it('opens the same document on two instances at once without the rooms waiting for each other', async () => {
		const [owner, editor] = await Promise.all([createUser(), createUser()]);
		const document = await createDocument({
			ownerId: owner.id,
			members: [{ userId: editor.id, role: 'editor' }],
		});
		const [instanceA, instanceB] = [await startInstance(), await startInstance()];
		const started = Date.now();

		const [socketA, socketB] = await Promise.all([
			openDocument(instanceA, document._id, owner.id),
			openDocument(instanceB, document._id, editor.id),
		]);
		const responses = await Promise.all(
			[socketA, socketB].map((socket) => socket.emitWithAck('doc:sync', emptyStateVector())),
		);

		expect(responses.map((response) => response.ok)).toEqual([true, true]);
		// A room that waited for the other would only give up after the 2s timeout
		expect(Date.now() - started).toBeLessThan(1500);
	});

	it('lets an instance with a room save only what its own clients sent', async () => {
		const { document, socketA, socketB } = await setupTwoInstances();
		await socketA.emitWithAck('doc:update', textUpdate('written on A'));
		// Close B first: it holds the update of A, but it is not the one that has to save it
		socketB.disconnect();
		await new Promise((resolve) => setTimeout(resolve, 200));

		expect(readText(await loadDocumentState(document._id))).toBe('');
	});
});

// The REST routes call the notifier of the last instance that started (access-notifier.ts is a singleton), so the
// sockets of these tests are on the other instance: a change made "on one machine" must reach the sockets of the other
describe.skipIf(!testRedisUrl)('access changes across instances', () => {
	const events = (socket: Socket) => {
		const received: string[] = [];
		socket.on('doc:access-changed', () => received.push('access-changed'));
		socket.on('disconnect', (reason) => received.push(`disconnect:${reason}`));
		return received;
	};

	it('disconnects a member whose role changed, on the instance that has their socket', async () => {
		const [owner, editor] = await Promise.all([createUser(), createUser()]);
		const document = await createDocument({
			ownerId: owner.id,
			members: [{ userId: editor.id, role: 'editor' }],
		});
		const instanceWithSocket = await startInstance();
		await startInstance();
		const socket = await openDocument(instanceWithSocket, document._id, editor.id);
		const received = events(socket);

		await request(app)
			.patch(`/api/documents/${document._id}/members/${editor.id}`)
			.set(asUser(owner.id))
			.send({ role: 'viewer' })
			.expect(200);

		await vi.waitFor(() =>
			expect(received).toEqual(['access-changed', 'disconnect:io server disconnect']),
		);
	});

	it('drops the room of the other instance when the document is deleted, so it is not saved back', async () => {
		const save = vi.spyOn(contentService, 'applyDocumentUpdate');
		const [owner, editor] = await Promise.all([createUser(), createUser()]);
		const document = await createDocument({
			ownerId: owner.id,
			members: [{ userId: editor.id, role: 'editor' }],
		});
		const instanceWithSocket = await startInstance();
		await startInstance();
		const socket = await openDocument(instanceWithSocket, document._id, editor.id);
		const received = events(socket);
		await socket.emitWithAck('doc:sync', emptyStateVector());
		await socket.emitWithAck('doc:update', textUpdate('unsaved'));

		await request(app).delete(`/api/documents/${document._id}`).set(asUser(owner.id)).expect(204);

		await vi.waitFor(() =>
			expect(received).toEqual(['access-changed', 'disconnect:io server disconnect']),
		);
		// The socket left, which would save the pending update if the room had not been dropped
		await new Promise((resolve) => setTimeout(resolve, 200));
		expect(save).not.toHaveBeenCalled();
		expect(instanceWithSocket.socketServer.rooms.size()).toBe(0);
		save.mockRestore();
	});
});

describe.skipIf(!testRedisUrl)('rooms catching up after Redis was gone', () => {
	it('sends the clients to sync again when their room learned what it missed', async () => {
		const { document, instanceA, instanceB, socketA, socketB } = await setupTwoInstances();
		// Each room gets an update of its own while the messages between the instances are lost, as if Redis
		// had been away. The update is real (pending, saved by the instance that received it)
		const lostA = vi.spyOn(instanceA.socketServer.io, 'serverSideEmit').mockReturnValue(true);
		const lostB = vi.spyOn(instanceB.socketServer.io, 'serverSideEmit').mockReturnValue(true);
		await instanceA.socketServer.rooms.applyUpdate(document._id, textUpdate('A'));
		await instanceB.socketServer.rooms.applyUpdate(document._id, textUpdate('B'));
		lostA.mockRestore();
		lostB.mockRestore();
		const disconnected = [socketA, socketB].map(
			(socket) => new Promise<string>((resolve) => socket.once('disconnect', resolve)),
		);
		const errors = vi.spyOn(console, 'error').mockImplementation(() => {});

		// Redis closes every connection, like a restart would
		const admin = createClient({ url: testRedisUrl });
		await admin.connect();
		await admin.sendCommand(['CLIENT', 'KILL', 'TYPE', 'normal']);
		await admin.sendCommand(['CLIENT', 'KILL', 'TYPE', 'pubsub']);
		await admin.close();

		expect(await Promise.all(disconnected)).toEqual([
			'io server disconnect',
			'io server disconnect',
		]);
		errors.mockRestore();

		// They come back and get what the rooms learned from each other
		const user = await createUser();
		await collections.documents.updateOne(
			{ _id: document._id },
			{ $push: { members: { userId: user.id, role: 'viewer' } } },
		);
		const fresh = await openDocument(instanceA, document._id, user.id);
		const response = await fresh.emitWithAck('doc:sync', emptyStateVector());
		const text = readText(response.update);
		expect(text).toContain('A');
		expect(text).toContain('B');
	});

	it('leaves the clients alone when their room had everything', async () => {
		const { socketA, socketB } = await setupTwoInstances();
		const disconnects = vi.fn();
		socketA.on('disconnect', disconnects);
		socketB.on('disconnect', disconnects);
		const errors = vi.spyOn(console, 'error').mockImplementation(() => {});

		const admin = createClient({ url: testRedisUrl });
		await admin.connect();
		await admin.sendCommand(['CLIENT', 'KILL', 'TYPE', 'normal']);
		await admin.sendCommand(['CLIENT', 'KILL', 'TYPE', 'pubsub']);
		await admin.close();
		await new Promise((resolve) => setTimeout(resolve, 500));

		expect(disconnects).not.toHaveBeenCalled();
		// And the instances talk again: an update still crosses
		const received = nextEvent<Uint8Array>(socketB, 'doc:update');
		await socketA.emitWithAck('doc:update', textUpdate('still works'));
		expect(readText(await received)).toBe('still works');
		errors.mockRestore();
	});
});
