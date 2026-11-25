import { ObjectId } from 'mongodb';

import { collections } from '../config/mongodb.js';
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
