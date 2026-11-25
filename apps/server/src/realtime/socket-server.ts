import type { Server as HttpServer } from 'node:http';

import { createAdapter } from '@socket.io/redis-adapter';
import { Server } from 'socket.io';

import { env } from '../config/env.js';
import type { RedisConnection } from '../config/redis.js';
import { type AccessNotifier, resetAccessNotifier, setAccessNotifier } from './access-notifier.js';
import { createDocumentRooms } from './document-rooms.js';
import { registerDocumentSocket } from './document-socket.js';
import { documentRoomName, memberRoomName } from './room-names.js';
import { createRoomPeers, noopRoomPeers, PEERS_TIMEOUT_MS } from './room-peers.js';
import { authenticateSocket } from './socket-auth.js';

export const SOCKET_PATH = '/api/socket.io';

// A single update (for example the diff of a long offline session) is bounded by this
const MAX_MESSAGE_BYTES = 2 * 1024 * 1024;

interface SocketServerOptions {
	/**
	 * Connects this instance to the others (docs/redis.md). Without it the server is a single instance.
	 * The caller owns the connection and closes it after close().
	 */
	redis?: RedisConnection;
}

export const createSocketServer = (httpServer: HttpServer, { redis }: SocketServerOptions = {}) => {
	const io = new Server(httpServer, {
		path: SOCKET_PATH,
		// WebSocket only: long-polling would need sticky sessions once there is more than one instance
		transports: ['websocket'],
		maxHttpBufferSize: MAX_MESSAGE_BYTES,
		cors: { origin: env.WEB_URL, credentials: true },
		// With Redis, what is broadcast to a room reaches the sockets of every instance
		...(redis && {
			adapter: createAdapter(redis.pub, redis.sub, { requestsTimeout: PEERS_TIMEOUT_MS }),
		}),
	});

	// Only the Redis adapter carries messages between instances (serverSideEmit)
	const peers = redis ? createRoomPeers(io, redis) : noopRoomPeers;
	const rooms = createDocumentRooms({ peers });
	peers.listen(rooms);

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
