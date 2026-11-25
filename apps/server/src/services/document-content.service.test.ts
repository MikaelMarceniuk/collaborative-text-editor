import { ObjectId } from 'mongodb';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { createDocument, createUser } from '../test/helpers.js';
import {
	applyDocumentUpdate,
	InvalidDocumentUpdateError,
	loadDocumentState,
} from './document-content.service.js';

const update = (name: string, text: string) => {
	const ydoc = new Y.Doc();
	ydoc.getText(name).insert(0, text);
	return Y.encodeStateAsUpdate(ydoc);
};

const setup = async () => {
	const owner = await createUser();
	return (await createDocument({ ownerId: owner.id }))._id;
};

describe('document content', () => {
	it('starts empty', async () => {
		const documentId = await setup();

		const state = new Y.Doc();
		Y.applyUpdate(state, await loadDocumentState(documentId));

		expect(state.share.size).toBe(0);
	});

	it('merges updates instead of replacing the stored state', async () => {
		const documentId = await setup();

		// Simultaneous writes read the same state: the optimistic version makes the loser retry on top of the winner
		await Promise.all([
			applyDocumentUpdate({ documentId, update: update('a', 'first') }),
			applyDocumentUpdate({ documentId, update: update('b', 'second') }),
		]);

		const state = new Y.Doc();
		Y.applyUpdate(state, await loadDocumentState(documentId));
		expect(state.getText('a').toString()).toBe('first');
		expect(state.getText('b').toString()).toBe('second');
	});

	it('rejects an invalid update and keeps the stored state', async () => {
		const documentId = await setup();
		await applyDocumentUpdate({ documentId, update: update('a', 'kept') });

		await expect(
			applyDocumentUpdate({ documentId, update: new Uint8Array([255, 255, 255]) }),
		).rejects.toThrow(InvalidDocumentUpdateError);

		const state = new Y.Doc();
		Y.applyUpdate(state, await loadDocumentState(documentId));
		expect(state.getText('a').toString()).toBe('kept');
	});

	it('ignores an update for a document that no longer exists', async () => {
		await expect(
			applyDocumentUpdate({ documentId: new ObjectId(), update: update('a', 'lost') }),
		).resolves.toBeUndefined();
	});
});
