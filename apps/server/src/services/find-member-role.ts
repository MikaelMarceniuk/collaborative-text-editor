import type { ObjectId } from 'mongodb';

import { collections } from '../config/mongodb.js';
import type { DocumentRole } from '../models/document.model.js';

/** The user's role in the document, or null when the document does not exist or they are not a member. */
export const findMemberRole = async (
	documentId: ObjectId,
	userId: ObjectId,
): Promise<DocumentRole | null> => {
	const document = await collections.documents.findOne(
		{ _id: documentId, 'members.userId': userId },
		{ projection: { members: 1 } },
	);

	return document?.members.find((member) => member.userId.equals(userId))?.role ?? null;
};
