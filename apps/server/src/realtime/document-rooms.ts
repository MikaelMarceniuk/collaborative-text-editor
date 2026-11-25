import type { ObjectId } from 'mongodb';
import * as Y from 'yjs';

import { applyDocumentUpdate, loadDocumentState } from '../services/document-content.service.js';
import { noopRoomPeers, type RoomPeers } from './room-peers.js';

export class InvalidUpdateError extends Error {}

interface Room {
	key: string;
	documentId: ObjectId;
	ydoc: Y.Doc;
	// Sockets currently in the room
	sockets: number;
	// Updates applied to the room that are not in Mongo yet
	pending: Uint8Array[];
	// The save in progress, if any
	saving: Promise<void> | null;
	idleTimer?: ReturnType<typeof setTimeout>;
	maxWaitTimer?: ReturnType<typeof setTimeout>;
	retryTimer?: ReturnType<typeof setTimeout>;
	retryAttempt: number;
	dropped: boolean;
}

interface DocumentRoomsOptions {
	/** Saves after this long without new updates. */
	idleMs?: number;
	/** Saves at most this long after the first unsaved update, even if edits keep coming. */
	maxWaitMs?: number;
	retryBaseMs?: number;
	retryMaxMs?: number;
	save?: (params: { documentId: ObjectId; update: Uint8Array }) => Promise<void>;
	/** The rooms of the other server instances. Without Redis there are none. */
	peers?: RoomPeers;
}

/**
 * The active documents, each with its Y.Doc in memory, so that answering a sync does not need a trip to Mongo.
 * A room is created by the first socket that joins the document and dropped when the last one leaves.
 * Mongo stays the source of truth: updates are saved with a debounce, always merged into the stored state
 * (applyDocumentUpdate), never replacing it.
 */
export const createDocumentRooms = ({
	idleMs = 2000,
	maxWaitMs = 10_000,
	retryBaseMs = 1000,
	retryMaxMs = 30_000,
	save = applyDocumentUpdate,
	peers = noopRoomPeers,
}: DocumentRoomsOptions = {}) => {
	// Keyed by the hex id. Holds the promise, so two simultaneous joins share one load
	const rooms = new Map<string, Promise<Room>>();
	// The rooms that finished loading. Another instance asking for the state must not wait for a room that is
	// still loading: that room may be waiting for the answer of the one asking (two clients opening the same
	// document on two instances at once), and it has no edits of its own yet anyway
	const loaded = new Map<string, Room>();

	const load = async (documentId: ObjectId): Promise<Room> => {
		// What another instance has not saved yet is not in Mongo, so it is asked for too. A failure here fails
		// the load: starting from a state that may be missing updates would leave the client with a broken document
		const [saved, fromPeers] = await Promise.all([
			loadDocumentState(documentId),
			peers.requestState(documentId),
		]);
		const ydoc = new Y.Doc();
		Y.applyUpdate(ydoc, saved);
		for (const state of fromPeers) Y.applyUpdate(ydoc, state);

		return {
			key: documentId.toHexString(),
			documentId,
			ydoc,
			sockets: 0,
			pending: [],
			saving: null,
			retryAttempt: 0,
			dropped: false,
		};
	};

	const getRoom = (documentId: ObjectId) => {
		const key = documentId.toHexString();
		let room = rooms.get(key);

		if (!room) {
			room = load(documentId);
			rooms.set(key, room);
			// A failed load must not stay in the map, or every later join would get the same rejection
			room.then(
				(loadedRoom) => {
					// Unless it was dropped while loading
					if (rooms.get(key) === room) loaded.set(key, loadedRoom);
				},
				() => rooms.delete(key),
			);
		}

		return room;
	};

	const clearTimers = (room: Room) => {
		clearTimeout(room.idleTimer);
		clearTimeout(room.maxWaitTimer);
		clearTimeout(room.retryTimer);
		room.idleTimer = room.maxWaitTimer = room.retryTimer = undefined;
	};

	// Drops the room when nobody is in it and everything is saved
	const evictIfIdle = (room: Room) => {
		if (room.sockets > 0 || room.pending.length > 0 || room.saving) return;

		clearTimers(room);
		rooms.delete(room.key);
		loaded.delete(room.key);
	};

	const scheduleRetry = (room: Room) => {
		const delay = Math.min(retryBaseMs * 2 ** room.retryAttempt, retryMaxMs);
		room.retryAttempt++;
		room.retryTimer = setTimeout(() => {
			room.retryTimer = undefined;
			void flush(room).then(() => evictIfIdle(room));
		}, delay);
	};

	// Saves what is pending, one batch at a time, until nothing is left or a save fails
	const flush = async (room: Room) => {
		clearTimeout(room.idleTimer);
		clearTimeout(room.maxWaitTimer);
		clearTimeout(room.retryTimer);
		room.idleTimer = room.maxWaitTimer = room.retryTimer = undefined;

		for (;;) {
			// Another flush is already saving: wait for it, then see whether anything new arrived
			if (room.saving) {
				await room.saving;
				continue;
			}
			if (room.pending.length === 0 || room.dropped) return;

			const batch = Y.mergeUpdates(room.pending);
			room.pending = [];

			const saving = save({ documentId: room.documentId, update: batch })
				.then(() => {
					room.retryAttempt = 0;
				})
				.catch((error: unknown) => {
					// TODO Improve with logs
					console.error('Could not save the document:', error);
					// Back to the front of the queue, so nothing is lost and the order is kept
					room.pending.unshift(batch);
					if (!room.dropped) scheduleRetry(room);
				})
				.finally(() => {
					room.saving = null;
				});
			room.saving = saving;
			await saving;

			// The retry timer is set only on failure: stop here and let it try again later
			if (room.retryTimer) return;
		}
	};

	const scheduleSave = (room: Room) => {
		// A failed save is waiting for its retry, which will also pick up this update
		if (room.retryTimer) return;

		clearTimeout(room.idleTimer);
		room.idleTimer = setTimeout(() => void flush(room), idleMs);
		room.maxWaitTimer ??= setTimeout(() => void flush(room), maxWaitMs);
	};

	return {
		/** Adds a socket to the document's room, loading the room if it is the first one. */
		join: async (documentId: ObjectId) => {
			const room = await getRoom(documentId);
			room.sockets++;
		},

		/** Removes a socket. When the last one leaves, saves what is pending and drops the room. */
		leave: async (documentId: ObjectId) => {
			const room = await rooms.get(documentId.toHexString())?.catch(() => undefined);
			if (!room) return;

			room.sockets--;
			if (room.sockets > 0) return;

			await flush(room);
			// A socket may have joined while it was saving
			evictIfIdle(room);
		},

		/** What the client is missing, given its state vector, plus the server's own state vector. */
		sync: async (documentId: ObjectId, clientStateVector: Uint8Array) => {
			const { ydoc } = await getRoom(documentId);

			return {
				update: Y.encodeStateAsUpdate(ydoc, clientStateVector),
				stateVector: Y.encodeStateVector(ydoc),
			};
		},

		/** Applies a client's update to the room and schedules it to be saved. Throws InvalidUpdateError for a bad update. */
		applyUpdate: async (documentId: ObjectId, update: Uint8Array) => {
			const room = await getRoom(documentId);

			try {
				Y.applyUpdate(room.ydoc, update);
			} catch {
				throw new InvalidUpdateError('Invalid document update');
			}

			room.pending.push(update);
			scheduleSave(room);
			peers.publishUpdate(documentId, update);
		},

		/**
		 * An update another instance applied. Only this instance's Y.Doc is brought up to date: the instance that
		 * received the update is the one that saves it. Waits for a room that is still loading, and ignores
		 * the update when there is no room (whoever opens the document later asks the other instances for its state).
		 */
		applyRemoteUpdate: async (documentId: ObjectId, update: Uint8Array) => {
			const room = await rooms.get(documentId.toHexString())?.catch(() => undefined);
			if (!room) return;

			try {
				Y.applyUpdate(room.ydoc, update);
			} catch {
				// The sender validated it before publishing, so this is not expected
			}
		},

		/** The state of the room, for another instance that is opening the document. Null when there is no room, or it is still loading. */
		stateOf: async (documentId: ObjectId) => {
			const room = loaded.get(documentId.toHexString());

			return room ? Y.encodeStateAsUpdate(room.ydoc) : null;
		},

		/** Saves every room now (shutdown). A room whose save fails keeps its updates but is not retried here. */
		flushAll: async () => {
			const active = await Promise.all(
				[...rooms.values()].map((room) => room.catch(() => undefined)),
			);

			await Promise.all(active.filter((room) => room !== undefined).map((room) => flush(room)));
		},

		/** Drops a room without saving it (the document was deleted). */
		drop: async (documentId: ObjectId) => {
			const key = documentId.toHexString();
			const room = await rooms.get(key)?.catch(() => undefined);
			if (!room) return;

			room.dropped = true;
			room.pending = [];
			clearTimers(room);
			rooms.delete(key);
			loaded.delete(key);
		},

		/** Number of active rooms, for tests. */
		size: () => rooms.size,
	};
};

export type DocumentRooms = ReturnType<typeof createDocumentRooms>;
