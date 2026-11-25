import { ObjectId } from 'mongodb';

import { collections, db } from '../config/mongodb.js';
import type { DocumentModel, DocumentRole } from '../models/document.model.js';

export const newUserId = () => new ObjectId();

export const asUser = (userId: ObjectId) => ({ 'x-test-user-id': userId.toHexString() });

interface CreateDocumentOptions {
	ownerId: ObjectId;
	members?: { userId: ObjectId; role: DocumentRole }[];
	title?: string;
}

// Inserts a document owned by ownerId, plus any extra members
export const createDocument = async ({
	ownerId,
	members = [],
	title = 'Test document',
}: CreateDocumentOptions) => {
	const now = new Date();

	const document: DocumentModel = {
		_id: new ObjectId(),
		title,
		ownerId,
		members: [{ userId: ownerId, role: 'owner' }, ...members],
		contentVersion: 0,
		createdAt: now,
		updatedAt: now,
	};

	await collections.documents.insertOne(document);

	return document;
};

interface CreateUserOptions {
	name?: string;
	email?: string;
	isAnonymous?: boolean;
}

// Inserts a user the way Better Auth stores it, so routes that look users up by id or email can find it
export const createUser = async ({
	name = 'Test user',
	email,
	isAnonymous = false,
}: CreateUserOptions = {}) => {
	const _id = new ObjectId();
	const now = new Date();

	await db.collection('user').insertOne({
		_id,
		name,
		email: email ?? `${_id.toHexString()}@test.local`,
		emailVerified: true,
		isAnonymous,
		createdAt: now,
		updatedAt: now,
	});

	return { id: _id, name, email: email ?? `${_id.toHexString()}@test.local` };
};
