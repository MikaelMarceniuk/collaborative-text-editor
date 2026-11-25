import type { ObjectId } from 'mongodb';

/** Every socket of a document. */
export const documentRoomName = (documentId: ObjectId) => `doc:${documentId.toHexString()}`;

/** The sockets of one user in a document (several tabs), to reach only them when their access changes. */
export const memberRoomName = (documentId: ObjectId, userId: ObjectId) =>
	`doc:${documentId.toHexString()}:user:${userId.toHexString()}`;
