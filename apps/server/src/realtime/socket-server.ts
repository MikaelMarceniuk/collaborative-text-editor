import type { Server as HttpServer } from 'node:http';

import { Server } from 'socket.io';

import { env } from '../config/env.js';
import { type AccessNotifier, resetAccessNotifier, setAccessNotifier } from './access-notifier.js';
import { createDocumentRooms } from './document-rooms.js';
import { registerDocumentSocket } from './document-socket.js';
import { documentRoomName, memberRoomName } from './room-names.js';
import { authenticateSocket } from './socket-auth.js';

export const SOCKET_PATH = '/api/socket.io';

// Same limit as the old POST /updates body
const MAX_MESSAGE_BYTES = 2 * 1024 * 1024;

export const createSocketServer = (httpServer: HttpServer) => {
	const io = new Server(httpServer, {
		path: SOCKET_PATH,
		// WebSocket only: long-polling would need sticky sessions once there is more than one instance
		transports: ['websocket'],
		maxHttpBufferSize: MAX_MESSAGE_BYTES,
		cors: { origin: env.WEB_URL, credentials: true },
	});

	const rooms = createDocumentRooms();

	io.use(authenticateSocket);
	io.on('connection', (socket) => registerDocumentSocket(rooms, socket));

	const notifier: AccessNotifier = {
		memberChanged: async (documentId, userId) => {
			const room = memberRoomName(documentId, userId);

			io.in(room).emit('doc:access-changed');
			io.in(room).disconnectSockets(true);
		},
		documentDeleted: async (documentId) => {
			const room = documentRoomName(documentId);

			// Dropped first, so the sockets leaving cannot save the deleted document back
			await rooms.drop(documentId);
			io.in(room).emit('doc:access-changed');
			io.in(room).disconnectSockets(true);
		},
	};
	setAccessNotifier(notifier);

	return {
		io,
		rooms,
		// Disconnects the sockets and closes the HTTP server (so it replaces httpServer.close()),
		// then saves what the rooms still hold. Nothing can arrive after the sockets are gone
		close: async () => {
			resetAccessNotifier();
			await io.close();
			await rooms.flushAll();
		},
	};
};
