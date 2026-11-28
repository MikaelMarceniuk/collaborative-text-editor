import { Binary } from 'mongodb';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { collections } from '../config/mongodb.js';
import { createDocument, newUserId } from '../test/helpers.js';
import { backfillSearchText } from './backfill-search-text.js';
import { CONTENT_FIELD } from './document-content.service.js';

const stateWith = (text: string) => {
	const ydoc = new Y.Doc();
	const paragraph = new Y.XmlElement('paragraph');
	paragraph.insert(0, [new Y.XmlText(text)]);
	ydoc.getXmlFragment(CONTENT_FIELD).insert(0, [paragraph]);
	return new Binary(Y.encodeStateAsUpdate(ydoc));
};

// A document the way it was saved before the search: content, and no searchText
const oldDocument = async (text: string) => {
	const document = await createDocument({ ownerId: newUserId() });
	await collections.documents.updateOne(
		{ _id: document._id },
		{ $set: { ydocState: stateWith(text), contentVersion: 3 } },
	);
	return document._id;
};

const stored = (id: Awaited<ReturnType<typeof oldDocument>>) =>
	collections.documents.findOne({ _id: id });

describe('backfillSearchText', () => {
	it('fills the text of documents saved before the search', async () => {
		const id = await oldDocument('written long ago');

		const result = await backfillSearchText();

		expect(result).toEqual({ updated: 1, skipped: 0 });
		expect((await stored(id))?.searchText).toBe('written long ago');
	});

	it('does not touch the content, its version or the date of the last change', async () => {
		const id = await oldDocument('same content');
		const before = await stored(id);

		await backfillSearchText();

		const after = await stored(id);
		expect(after?.contentVersion).toBe(3);
		expect(after?.updatedAt).toEqual(before?.updatedAt);
		expect(after?.ydocState?.buffer).toEqual(before?.ydocState?.buffer);
	});

	it('leaves alone documents that have a text already, and documents that were never edited', async () => {
		const id = await oldDocument('from the backfill');
		await collections.documents.updateOne({ _id: id }, { $set: { searchText: 'already here' } });
		const empty = await createDocument({ ownerId: newUserId() });

		const result = await backfillSearchText();

		expect(result).toEqual({ updated: 0, skipped: 0 });
		expect((await stored(id))?.searchText).toBe('already here');
		expect((await stored(empty._id))?.searchText).toBeUndefined();
	});

	it('can run again: the second run has nothing to do', async () => {
		await oldDocument('one');
		await oldDocument('two');

		expect(await backfillSearchText()).toEqual({ updated: 2, skipped: 0 });
		expect(await backfillSearchText()).toEqual({ updated: 0, skipped: 0 });
	});
});
