import { ObjectId } from 'mongodb';
import type { ExtendedError, Socket } from 'socket.io';

import type { DocumentRole } from '../models/document.model.js';
import { findMemberRole } from '../services/find-member-role.js';
import { getSocketUser } from './socket-session.js';

export interface DocumentSocketData {
	userId: ObjectId;
	documentId: ObjectId;
	// Cached for the life of the socket: the routes that change a member's role update it (see access.ts)
	role: DocumentRole;
}

const reject = (message: 'unauthorized' | 'not_found') => new Error(message);

/**
 * Socket.IO middleware. Each socket is for one document, given in `auth.documentId` of the handshake.
 * - "unauthorized" when there is no session
 * - "not_found" when the id is invalid or the user is not a member (same criteria as the 404 of the REST routes)
 * It runs again on every reconnection, so someone removed while offline does not get back in.
 */
export const authenticateSocket = async (socket: Socket, next: (error?: ExtendedError) => void) => {
	try {
		const user = await getSocketUser(socket.request.headers);
		if (!user) return next(reject('unauthorized'));

		const documentId: unknown = socket.handshake.auth.documentId;
		if (typeof documentId !== 'string' || !ObjectId.isValid(documentId)) {
			return next(reject('not_found'));
		}

		const userId = new ObjectId(user.id);
		const role = await findMemberRole(new ObjectId(documentId), userId);
		if (!role) return next(reject('not_found'));

		socket.data = {
			userId,
			documentId: new ObjectId(documentId),
			role,
		} satisfies DocumentSocketData;
		next();
	} catch (error) {
		// TODO Improve with logs
		console.error('Socket authentication failed:', error);
		next(new Error('internal_error'));
	}
};
