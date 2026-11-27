import type { ObjectId } from 'mongodb';
import * as Y from 'yjs';

import { applyDocumentUpdate, loadDocumentState } from '../services/document-content.service.js';
import { replaceContent } from '../services/replace-content.js';

/**
 * What the REST routes ask of the content of a document that people may be editing right now: its current state
 * (which may be ahead of Mongo) and the replacement of its content by a version. The socket server registers the
 * implementation that goes through the rooms, so the change reaches the editors, and the other instances.
 * Until then (and in route tests) it works straight on Mongo, as if nobody had the document open.
 */
export interface LiveContent {
	currentState(documentId: ObjectId): Promise<Uint8Array>;
	restore(documentId: ObjectId, snapshot: Uint8Array): Promise<void>;
}

const mongoOnly: LiveContent = {
	currentState: loadDocumentState,
	restore: async (documentId, snapshot) => {
		const ydoc = new Y.Doc();
		Y.applyUpdate(ydoc, await loadDocumentState(documentId));

		const update = replaceContent(ydoc, snapshot);
		if (update) await applyDocumentUpdate({ documentId, update });
	},
};

let current = mongoOnly;

export const setLiveContent = (liveContent: LiveContent) => {
	current = liveContent;
};

export const resetLiveContent = () => {
	current = mongoOnly;
};

export const liveContent: LiveContent = {
	currentState: (documentId) => current.currentState(documentId),
	restore: (documentId, snapshot) => current.restore(documentId, snapshot),
};
