import { ObjectId } from 'mongodb';
import type { Server } from 'socket.io';

import type { RedisConnection } from '../config/redis.js';

/** How long an instance waits for the others to answer (the state of a room), before the join fails. */
export const PEERS_TIMEOUT_MS = 2000;

/**
 * How a document room talks to the same room on the other server instances (docs/redis.md).
 * The Redis adapter only relays messages between sockets; the Y.Doc each instance keeps in memory needs this.
 */
export interface RoomPeers {
	/** Tells the other instances about an update applied here, so their rooms (if they have one) apply it too. */
	publishUpdate: (documentId: ObjectId, update: Uint8Array) => void;
	/**
	 * What the other instances hold for the document: one state for each that has the room open, none for the rest.
	 * Rejects when an instance does not answer in time, so a room never starts from a state that is missing updates.
	 */
	requestState: (documentId: ObjectId) => Promise<Uint8Array[]>;
	/** Starts answering the other instances, using the rooms of this one. Called once, right after the rooms exist. */
	listen: (handlers: RoomPeersHandlers) => void;
}

/** What this instance's rooms offer to the other instances. */
export interface RoomPeersHandlers {
	/** An update the other instance applied. Ignored when there is no room for the document here. */
	applyRemoteUpdate: (documentId: ObjectId, update: Uint8Array) => Promise<void>;
	/** The room's state, or null when this instance has no room for the document. */
	stateOf: (documentId: ObjectId) => Promise<Uint8Array | null>;
}

/** Without Redis there is no one else: updates go nowhere and nobody has anything to add. */
export const noopRoomPeers: RoomPeers = {
	publishUpdate: () => {},
	requestState: async () => [],
	listen: () => {},
};

// serverSideEmit sends its arguments as JSON, which turns a Uint8Array into {"0":1,"1":2}, and an argument
// that is binary together with an ack into {}. Everything goes as base64 text instead (see docs/redis.md)
const encode = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');
const decode = (text: string) => new Uint8Array(Buffer.from(text, 'base64'));

const toObjectId = (value: unknown) =>
	typeof value === 'string' && ObjectId.isValid(value) ? new ObjectId(value) : null;

/**
 * Needs the Redis adapter on the server: the default adapter does not carry serverSideEmit to anyone.
 * While Redis is unreachable the instance works on its own: it publishes nothing and opens rooms from Mongo alone,
 * and the rooms catch up with the others when the connection is back (docs/redis.md, "Redis fora do ar").
 */
export const createRoomPeers = (io: Server, redis: RedisConnection): RoomPeers => ({
	publishUpdate: (documentId, update) => {
		// The client would queue the command and send it, late and out of order, when it reconnects
		if (!redis.pub.isReady) return;

		io.serverSideEmit('room:update', documentId.toHexString(), encode(update));
	},

	requestState: async (documentId) => {
		if (!redis.pub.isReady) return [];

		// The adapter times out the instances that do not answer, but a command waiting for a reconnection
		// never gets that far, so the whole request has its own limit
		let timer: ReturnType<typeof setTimeout> | undefined;
		const timeout = new Promise<never>((_, reject) => {
			timer = setTimeout(
				() => reject(new Error('The other instances did not answer in time')),
				PEERS_TIMEOUT_MS + 500,
			);
		});

		try {
			const responses: unknown[] = await Promise.race([
				io.serverSideEmitWithAck('room:state', documentId.toHexString()),
				timeout,
			]);

			return responses.filter((state) => typeof state === 'string').map(decode);
		} finally {
			clearTimeout(timer);
		}
	},

	listen: ({ applyRemoteUpdate, stateOf }) => {
		io.on('room:update', (id: unknown, update: unknown) => {
			const documentId = toObjectId(id);
			if (!documentId || typeof update !== 'string') return;

			applyRemoteUpdate(documentId, decode(update)).catch(() => undefined);
		});

		io.on('room:state', (id: unknown, ack: unknown) => {
			if (typeof ack !== 'function') return;

			const documentId = toObjectId(id);
			if (!documentId) return ack(null);

			stateOf(documentId)
				.then((state) => ack(state && encode(state)))
				.catch(() => ack(null));
		});
	},
});
