import type { Socket } from 'socket.io';

import { documentRoomName } from './room-names.js';
import type { DocumentSocketData } from './socket-auth.js';

interface AwarenessMessage {
	clientId: number;
	update: Uint8Array;
}

const isBytes = (value: unknown): value is Uint8Array => value instanceof Uint8Array;

const isAwarenessMessage = (value: unknown): value is AwarenessMessage => {
	if (typeof value !== 'object' || value === null) return false;
	const { clientId, update } = value as Partial<AwarenessMessage>;
	return Number.isSafeInteger(clientId) && isBytes(update);
};

/**
 * The presence events of one document socket (see docs/presence.md, "Protocol"). The server keeps no presence state:
 * - awareness:update: a client's cursor and user, relayed to the others of the document
 * - awareness:query: a client that just arrived asks the others to send their state again
 * - awareness:left: sent when the socket disconnects, so the others remove its cursor right away
 * Presence is not content, so every member can send it, viewers included. Nothing here waits for an ack, and anything
 * malformed is ignored without dropping the connection.
 */
export const registerDocumentAwareness = (socket: Socket) => {
	const { documentId } = socket.data as DocumentSocketData;
	const room = documentRoomName(documentId);

	// A socket speaks for one Yjs client only: the first id it sends is the one it keeps
	let clientId: number | undefined;
	// Socket.IO handles an event one tick after it arrives, but a disconnection right away, so the last update
	// of a tab that is closing can show up after "disconnecting". Relaying it then would leave a cursor nobody removes
	let gone = false;

	socket.on('awareness:update', (message: unknown) => {
		if (gone || !isAwarenessMessage(message)) return;

		clientId ??= message.clientId;
		if (message.clientId !== clientId) return;

		// Old cursor positions are worthless, so a busy or dropped connection may skip them
		socket.volatile.to(room).emit('awareness:update', message);
	});

	socket.on('awareness:query', () => {
		socket.to(room).emit('awareness:query');
	});

	// Nobody else can tell the client is gone before the 30s timeout of the Awareness, so the server says it.
	// "disconnecting" still has the rooms, which "disconnect" no longer does
	socket.on('disconnecting', () => {
		gone = true;
		if (clientId === undefined) return;
		socket.to(room).emit('awareness:left', clientId);
	});
};
