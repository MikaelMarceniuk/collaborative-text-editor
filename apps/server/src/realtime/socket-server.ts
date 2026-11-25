import type { Server as HttpServer } from 'node:http';

import { Server } from 'socket.io';

import { env } from '../config/env.js';
import { createDocumentRooms } from './document-rooms.js';
import { registerDocumentSocket } from './document-socket.js';
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

	return {
		io,
		rooms,
		// Disconnects the sockets and closes the HTTP server (so it replaces httpServer.close()),
		// then saves what the rooms still hold. Nothing can arrive after the sockets are gone
		close: async () => {
			await io.close();
			await rooms.flushAll();
		},
	};
};
