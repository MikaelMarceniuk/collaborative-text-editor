import { ObjectId } from 'mongodb';

import { collections } from '../config/mongodb.js';

type transferGuestDocumentsParams = {
	guestUserId: string;
	userId: string;
};

export async function transferGuestDocuments({
	guestUserId,
	userId,
}: transferGuestDocumentsParams) {
	const guestId = new ObjectId(guestUserId);
	const newOwnerId = new ObjectId(userId);

	await collections.documents.updateMany({ ownerId: guestId }, { $set: { ownerId: newOwnerId } });

	await collections.documents.updateMany(
		{ 'members.userId': guestId },
		{ $set: { 'members.$[member].userId': newOwnerId } },
		{ arrayFilters: [{ 'member.userId': guestId }] },
	);
}
