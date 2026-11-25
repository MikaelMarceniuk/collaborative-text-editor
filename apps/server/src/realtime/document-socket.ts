import type { Socket } from 'socket.io';

import type { DocumentRole } from '../models/document.model.js';
import { registerDocumentAwareness } from './document-awareness.js';
import { type DocumentRooms, InvalidUpdateError } from './document-rooms.js';
import { documentRoomName, memberRoomName } from './room-names.js';
import type { DocumentSocketData } from './socket-auth.js';

export const canEditRole = (role: DocumentRole) => role === 'owner' || role === 'editor';

type Ack = (response: unknown) => void;

// The client sends bytes. Socket.IO delivers them as a Buffer, which is a Uint8Array
const isBytes = (value: unknown): value is Uint8Array => value instanceof Uint8Array;

// A client can omit the ack callback, and calling undefined would throw inside the handler
const respond = (ack: unknown, response: unknown) => {
	if (typeof ack === 'function') (ack as Ack)(response);
};

/**
 * The events of one document socket (see docs/realtime.md, "Protocol"):
 * - doc:sync: the client sends its state vector and gets what it is missing, plus the server's state vector
 * - doc:update: a client's edit, applied to the room and relayed to the others (only for editors)
 * Handlers are registered right away, but wait for the join to finish, because the client can emit as soon as it connects.
 */
export const registerDocumentSocket = (rooms: DocumentRooms, socket: Socket) => {
	const data = socket.data as DocumentSocketData;
	const { documentId, userId } = data;
	const room = documentRoomName(documentId);

	registerDocumentAwareness(socket);

	const joined = (async () => {
		await rooms.join(documentId);
		await socket.join([room, memberRoomName(documentId, userId)]);
	})();

	joined.catch((error: unknown) => {
		// TODO Improve with logs
		console.error('Could not join the document room:', error);
		socket.disconnect(true);
	});

	socket.on('disconnect', () => {
		// Leaves only a room it joined: a failed join never incremented the count
		void joined.then(() => rooms.leave(documentId)).catch(() => undefined);
	});

	socket.on('doc:sync', async (stateVector: unknown, ack: unknown) => {
		if (!isBytes(stateVector)) return respond(ack, { ok: false, error: 'invalid' });

		try {
			await joined;
			const { update, stateVector: serverStateVector } = await rooms.sync(documentId, stateVector);

			respond(ack, { ok: true, role: data.role, update, stateVector: serverStateVector });
		} catch {
			respond(ack, { ok: false, error: 'invalid' });
		}
	});

	socket.on('doc:update', async (update: unknown, ack: unknown) => {
		if (!isBytes(update)) return respond(ack, { ok: false, error: 'invalid' });
		if (!canEditRole(data.role)) return respond(ack, { ok: false, error: 'forbidden' });

		try {
			await joined;
			await rooms.applyUpdate(documentId, update);
		} catch (error) {
			if (!(error instanceof InvalidUpdateError)) {
				// TODO Improve with logs
				console.error('Could not apply the document update:', error);
			}
			return respond(ack, { ok: false, error: 'invalid' });
		}

		// The sender already has its own update, so only the others receive it
		socket.to(room).emit('doc:update', update);
		respond(ack, { ok: true });
	});
};
