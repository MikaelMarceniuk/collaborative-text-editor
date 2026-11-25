import type { ObjectId } from 'mongodb';
import * as Y from 'yjs';

import { loadDocumentState } from '../services/document-content.service.js';

export class InvalidUpdateError extends Error {}

interface Room {
	ydoc: Y.Doc;
	// Sockets currently in the room. The room is dropped when it reaches zero
	sockets: number;
}

/**
 * The active documents, each with its Y.Doc in memory, so that answering a sync does not need a trip to Mongo.
 * A room is created by the first socket that joins the document and dropped when the last one leaves.
 * Mongo stays the source of truth: the room only caches the state while someone has the document open.
 */
export const createDocumentRooms = () => {
	// Keyed by the hex id. Holds the promise, so two simultaneous joins share one load
	const rooms = new Map<string, Promise<Room>>();

	const load = async (documentId: ObjectId): Promise<Room> => {
		const ydoc = new Y.Doc();
		Y.applyUpdate(ydoc, await loadDocumentState(documentId));

		return { ydoc, sockets: 0 };
	};

	const getRoom = (documentId: ObjectId) => {
		const key = documentId.toHexString();
		let room = rooms.get(key);

		if (!room) {
			room = load(documentId);
			rooms.set(key, room);
			// A failed load must not stay in the map, or every later join would get the same rejection
			room.catch(() => rooms.delete(key));
		}

		return room;
	};

	return {
		/** Adds a socket to the document's room, loading the room if it is the first one. */
		join: async (documentId: ObjectId) => {
			const room = await getRoom(documentId);
			room.sockets++;
		},

		leave: async (documentId: ObjectId) => {
			const key = documentId.toHexString();
			const room = await rooms.get(key)?.catch(() => undefined);
			if (!room) return;

			room.sockets--;
			if (room.sockets === 0) rooms.delete(key);
		},

		/** What the client is missing, given its state vector, plus the server's own state vector. */
		sync: async (documentId: ObjectId, clientStateVector: Uint8Array) => {
			const { ydoc } = await getRoom(documentId);

			return {
				update: Y.encodeStateAsUpdate(ydoc, clientStateVector),
				stateVector: Y.encodeStateVector(ydoc),
			};
		},

		/** Applies a client's update to the room. Throws InvalidUpdateError when it is not a valid Yjs update. */
		applyUpdate: async (documentId: ObjectId, update: Uint8Array) => {
			const { ydoc } = await getRoom(documentId);

			try {
				Y.applyUpdate(ydoc, update);
			} catch {
				throw new InvalidUpdateError('Invalid document update');
			}
		},

		/** Drops a room without saving it (the document was deleted). */
		drop: (documentId: ObjectId) => {
			rooms.delete(documentId.toHexString());
		},

		/** Number of active rooms, for tests. */
		size: () => rooms.size,
	};
};

export type DocumentRooms = ReturnType<typeof createDocumentRooms>;
