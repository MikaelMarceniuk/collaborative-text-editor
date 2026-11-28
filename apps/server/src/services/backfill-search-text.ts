import { collections } from '../config/mongodb.js';
import { searchTextOf } from './document-content.service.js';

/**
 * Fills `searchText` in the documents that were saved before the search existed: they have content but no text for
 * the index. Safe to run again and while the server is up: a document is only written if it still has no
 * `searchText` and is still at the content version that was read, so it never overwrites an edit that arrived in
 * between (that edit already wrote its own `searchText`).
 */
export const backfillSearchText = async () => {
	let updated = 0;
	let skipped = 0;

	const documents = collections.documents
		.find(
			{ ydocState: { $exists: true }, searchText: { $exists: false } },
			{ projection: { ydocState: 1, contentVersion: 1 } },
		)
		.batchSize(50);

	for await (const document of documents) {
		if (!document.ydocState) continue;

		const result = await collections.documents.updateOne(
			{
				_id: document._id,
				contentVersion: document.contentVersion ?? { $exists: false },
				searchText: { $exists: false },
			},
			// Not updatedAt, and not contentVersion: the content did not change, so nothing else has to notice
			{ $set: { searchText: searchTextOf(document.ydocState.buffer) } },
		);

		if (result.modifiedCount === 1) updated++;
		else skipped++;
	}

	return { updated, skipped };
};
