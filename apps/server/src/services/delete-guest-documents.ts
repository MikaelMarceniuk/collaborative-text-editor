import { ObjectId } from 'mongodb';

import { collections } from '../config/mongodb.js';
import { deleteVersionsOf } from './document-versions.service.js';

type deleteGuestDocumentsParams = {
	guestUserId: string;
};

export async function deleteGuestDocuments({ guestUserId }: deleteGuestDocumentsParams) {
	const guestId = new ObjectId(guestUserId);

	const documents = await collections.documents
		.find({ ownerId: guestId })
		.project<{ _id: ObjectId }>({ _id: 1 })
		.toArray();

	await deleteVersionsOf(documents.map(({ _id }) => _id));
	await collections.documents.deleteMany({ ownerId: guestId });
}
