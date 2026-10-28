import { ObjectId } from 'mongodb';

import { collections } from '../config/mongodb.js';

type deleteGuestDocumentsParams = {
	guestUserId: string;
};

export async function deleteGuestDocuments({ guestUserId }: deleteGuestDocumentsParams) {
	const guestId = new ObjectId(guestUserId);

	await collections.documents.deleteMany({ ownerId: guestId });
}
