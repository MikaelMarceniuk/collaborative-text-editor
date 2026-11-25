import type { Server as HttpServer } from 'node:http';

import { Server } from 'socket.io';

import { env } from '../config/env.js';
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

	io.use(authenticateSocket);

	return {
		io,
		// Also closes the HTTP server, so it replaces httpServer.close()
		close: () => io.close(),
	};
};
