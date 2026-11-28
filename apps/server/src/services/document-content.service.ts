import { Binary, type ObjectId } from 'mongodb';
import * as Y from 'yjs';

import { collections } from '../config/mongodb.js';
import { extractText } from './extract-text.js';

export class InvalidDocumentUpdateError extends Error {}

/** The Y.XmlFragment the editor writes to: the default field of Tiptap's Collaboration extension. */
export const CONTENT_FIELD = 'default';

/** The text of an encoded document state, as kept in `searchText` for the search index. */
export const searchTextOf = (state: Uint8Array) => {
	const ydoc = new Y.Doc();
	try {
		Y.applyUpdate(ydoc, state);
		return extractText(ydoc.getXmlFragment(CONTENT_FIELD));
	} finally {
		ydoc.destroy();
	}
};

const assertValidDocumentUpdate = (update: Uint8Array) => {
	try {
		Y.applyUpdate(new Y.Doc(), update);
	} catch {
		throw new InvalidDocumentUpdateError('Invalid document update');
	}
};

export const loadDocumentState = async (documentId: ObjectId) => {
	const document = await collections.documents.findOne(
		{ _id: documentId },
		{ projection: { ydocState: 1 } },
	);

	if (document?.ydocState) {
		return document.ydocState.buffer;
	}

	return Y.encodeStateAsUpdate(new Y.Doc());
};

type applyDocumentUpdateParams = {
	documentId: ObjectId;
	update: Uint8Array;
};

const MAX_UPDATE_ATTEMPTS = 3;

export const applyDocumentUpdate = async ({ documentId, update }: applyDocumentUpdateParams) => {
	assertValidDocumentUpdate(update);

	for (let attempt = 1; attempt <= MAX_UPDATE_ATTEMPTS; attempt++) {
		const document = await collections.documents.findOne(
			{ _id: documentId },
			{ projection: { ydocState: 1, contentVersion: 1 } },
		);
		if (!document) return;

		const currentState = document.ydocState?.buffer ?? Y.encodeStateAsUpdate(new Y.Doc());
		const newState = Y.mergeUpdates([currentState, update]);

		const result = await collections.documents.updateOne(
			{
				_id: documentId,
				contentVersion: document.contentVersion ?? { $exists: false },
			},
			{
				// The text for the search goes in the same write, so it is never out of step with the content
				$set: {
					ydocState: new Binary(newState),
					searchText: searchTextOf(newState),
					updatedAt: new Date(),
				},
				$inc: { contentVersion: 1 },
			},
		);

		if (result.matchedCount === 1) return;
	}

	throw new Error('Could not apply document update: too many concurrent writes');
};
