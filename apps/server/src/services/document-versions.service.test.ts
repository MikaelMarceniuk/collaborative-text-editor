import { ObjectId } from 'mongodb';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { collections } from '../config/mongodb.js';
import { createDocument, createUser } from '../test/helpers.js';
import { CONTENT_FIELD } from './document-content.service.js';
import {
	AUTO_VERSION_INTERVAL_MS,
	createAutoVersionIfDue,
	createVersion,
	deleteVersionsOf,
	getVersion,
	listVersions,
	keepBeforeRestore,
	MAX_AUTO_VERSIONS,
	MAX_BEFORE_RESTORE_VERSIONS,
	saveManualVersion,
} from './document-versions.service.js';

/** A document state with one paragraph, the way the editor writes it. */
const stateWith = (text: string) => {
	const ydoc = new Y.Doc();
	const paragraph = new Y.XmlElement('paragraph');
	paragraph.insert(0, [new Y.XmlText(text)]);
	ydoc.getXmlFragment(CONTENT_FIELD).insert(0, [paragraph]);

	return Y.encodeStateAsUpdate(ydoc);
};

const setup = async () => {
	const owner = await createUser();
	const document = await createDocument({ ownerId: owner.id });

	return { owner, documentId: document._id };
};

const minutes = (count: number) => count * 60 * 1000;

describe('createVersion, listVersions and getVersion', () => {
	it('lists the newest first, without the snapshots', async () => {
		const { owner, documentId } = await setup();
		await createVersion({ documentId, kind: 'manual', state: stateWith('one'), label: 'first' });
		await createVersion({
			documentId,
			kind: 'manual',
			state: stateWith('two'),
			createdBy: owner.id,
		});

		const versions = await listVersions(documentId);

		expect(versions).toHaveLength(2);
		expect(versions[0]?.createdBy?.equals(owner.id)).toBe(true);
		expect(versions[1]?.label).toBe('first');
		expect(versions.every((version) => !('snapshot' in version))).toBe(true);
		expect(versions[0]?.size).toBeGreaterThan(0);
	});

	it('does not list the versions of another document', async () => {
		const { documentId } = await setup();
		const other = await setup();
		await createVersion({ documentId, kind: 'manual', state: stateWith('mine') });
		await createVersion({ documentId: other.documentId, kind: 'manual', state: stateWith('x') });

		expect(await listVersions(documentId)).toHaveLength(1);
	});

	it('gets a version with its snapshot, and only through its own document', async () => {
		const { documentId } = await setup();
		const other = await setup();
		const version = await createVersion({ documentId, kind: 'manual', state: stateWith('hello') });

		const found = await getVersion(documentId, version._id);

		const ydoc = new Y.Doc();
		Y.applyUpdate(ydoc, found!.snapshot.buffer);
		expect(ydoc.getXmlFragment(CONTENT_FIELD).toString()).toContain('hello');
		expect(await getVersion(other.documentId, version._id)).toBeNull();
		expect(await getVersion(documentId, new ObjectId())).toBeNull();
	});

	it('deletes the versions of the given documents', async () => {
		const first = await setup();
		const second = await setup();
		const third = await setup();
		for (const { documentId } of [first, second, third]) {
			await createVersion({ documentId, kind: 'manual', state: stateWith('x') });
		}

		await deleteVersionsOf([first.documentId, second.documentId]);

		expect(await listVersions(first.documentId)).toHaveLength(0);
		expect(await listVersions(second.documentId)).toHaveLength(0);
		expect(await listVersions(third.documentId)).toHaveLength(1);
	});
});

describe('createAutoVersionIfDue', () => {
	it('makes the first version right away', async () => {
		const { documentId } = await setup();

		const version = await createAutoVersionIfDue({
			documentId,
			getState: () => stateWith('a'),
			when: 'due',
		});

		expect(version?.kind).toBe('auto');
		expect(version?.createdBy).toBeUndefined();
		expect((await collections.documents.findOne({ _id: documentId }))?.versionedAt).toBeDefined();
	});

	it('waits for the interval before making another one ("due")', async () => {
		const { documentId } = await setup();
		const start = new Date();
		await createAutoVersionIfDue({
			documentId,
			getState: () => stateWith('a'),
			when: 'due',
			now: start,
		});

		const tooSoon = await createAutoVersionIfDue({
			documentId,
			getState: () => stateWith('b'),
			when: 'due',
			now: new Date(start.getTime() + AUTO_VERSION_INTERVAL_MS - 1000),
		});
		const later = await createAutoVersionIfDue({
			documentId,
			getState: () => stateWith('c'),
			when: 'due',
			now: new Date(start.getTime() + AUTO_VERSION_INTERVAL_MS + 1000),
		});

		expect(tooSoon).toBeNull();
		expect(later).not.toBeNull();
		expect(await listVersions(documentId)).toHaveLength(2);
	});

	it('makes one when the document changed since the last one, however recent ("changed")', async () => {
		const { documentId } = await setup();
		const start = new Date();
		await createAutoVersionIfDue({
			documentId,
			getState: () => stateWith('a'),
			when: 'due',
			now: start,
		});

		const unchanged = await createAutoVersionIfDue({
			documentId,
			getState: () => stateWith('a'),
			when: 'changed',
			now: new Date(start.getTime() + 1000),
		});
		// A save after the version
		await collections.documents.updateOne(
			{ _id: documentId },
			{ $set: { updatedAt: new Date(start.getTime() + 2000) } },
		);
		const changed = await createAutoVersionIfDue({
			documentId,
			getState: () => stateWith('b'),
			when: 'changed',
			now: new Date(start.getTime() + 3000),
		});

		expect(unchanged).toBeNull();
		expect(changed).not.toBeNull();
	});

	it('makes only one version when two instances ask at the same time', async () => {
		const { documentId } = await setup();

		const results = await Promise.all(
			Array.from({ length: 5 }, () =>
				createAutoVersionIfDue({ documentId, getState: () => stateWith('a'), when: 'due' }),
			),
		);

		expect(results.filter((version) => version !== null)).toHaveLength(1);
		expect(await listVersions(documentId)).toHaveLength(1);
	});

	it('keeps only the newest automatic versions, and never removes the others', async () => {
		const { documentId } = await setup();
		await createVersion({ documentId, kind: 'manual', state: stateWith('manual') });
		await createVersion({ documentId, kind: 'before-restore', state: stateWith('before') });
		const start = Date.now();

		for (let index = 0; index <= MAX_AUTO_VERSIONS; index++) {
			await createAutoVersionIfDue({
				documentId,
				getState: () => stateWith(`v${index}`),
				when: 'due',
				// Each one past the interval of the previous
				now: new Date(start + index * (AUTO_VERSION_INTERVAL_MS + minutes(1))),
			});
		}

		const versions = await listVersions(documentId);
		expect(versions.filter(({ kind }) => kind === 'auto')).toHaveLength(MAX_AUTO_VERSIONS);
		expect(versions.filter(({ kind }) => kind === 'manual')).toHaveLength(1);
		expect(versions.filter(({ kind }) => kind === 'before-restore')).toHaveLength(1);
	});
});

describe('saveManualVersion', () => {
	it('makes a version, and answers the same one while nothing changes', async () => {
		const { owner, documentId } = await setup();

		// Each stateWith is a document of its own (another client id), so the same one is reused
		const state = stateWith('text');
		const first = await saveManualVersion({ documentId, state, createdBy: owner.id });
		const again = await saveManualVersion({ documentId, state, createdBy: owner.id });

		expect(first.created).toBe(true);
		expect(again.created).toBe(false);
		expect(again.version._id.equals(first.version._id)).toBe(true);
		expect(await listVersions(documentId)).toHaveLength(1);
	});

	it('knows the same document in other bytes (the update merged by Mongo against the encoding of a Y.Doc)', async () => {
		const { owner, documentId } = await setup();
		const ydoc = new Y.Doc();
		const paragraph = new Y.XmlElement('paragraph');
		paragraph.insert(0, [new Y.XmlText('same')]);
		ydoc.getXmlFragment(CONTENT_FIELD).insert(0, [paragraph]);
		const encoded = Y.encodeStateAsUpdate(ydoc);
		// Two updates merged: the same content, in a different sequence of bytes
		const merged = Y.mergeUpdates([encoded, Y.encodeStateAsUpdate(new Y.Doc())]);
		await saveManualVersion({ documentId, state: encoded, createdBy: owner.id });

		const again = await saveManualVersion({ documentId, state: merged, createdBy: owner.id });

		expect(again.created).toBe(false);
	});

	it('makes a new version when the text changed', async () => {
		const { owner, documentId } = await setup();
		await saveManualVersion({ documentId, state: stateWith('one'), createdBy: owner.id });

		const next = await saveManualVersion({
			documentId,
			state: stateWith('two'),
			createdBy: owner.id,
		});

		expect(next.created).toBe(true);
		expect(await listVersions(documentId)).toHaveLength(2);
	});

	it('turns the newest version into a named manual one when it is the same text', async () => {
		const { owner, documentId } = await setup();
		const state = stateWith('text');
		const auto = await createAutoVersionIfDue({ documentId, getState: () => state, when: 'due' });

		const named = await saveManualVersion({
			documentId,
			state,
			label: 'Keep this',
			createdBy: owner.id,
		});

		expect(named.created).toBe(false);
		expect(named.version._id.equals(auto!._id)).toBe(true);
		expect(named.version).toMatchObject({ kind: 'manual', label: 'Keep this' });
		expect(named.version.createdBy?.equals(owner.id)).toBe(true);
		// A name it already has changes nothing
		const same = await saveManualVersion({
			documentId,
			state,
			label: 'Keep this',
			createdBy: owner.id,
		});
		expect(same.version._id.equals(auto!._id)).toBe(true);
		expect(await listVersions(documentId)).toHaveLength(1);
	});

	it('never removes the manual ones, however many there are', async () => {
		const { owner, documentId } = await setup();

		for (let index = 0; index < MAX_AUTO_VERSIONS + 5; index++) {
			await saveManualVersion({
				documentId,
				state: stateWith(`text ${index}`),
				createdBy: owner.id,
			});
		}

		expect(await listVersions(documentId)).toHaveLength(MAX_AUTO_VERSIONS + 5);
	});
});

describe('keepBeforeRestore', () => {
	it('keeps the current content, and the newest ones only', async () => {
		const { owner, documentId } = await setup();
		await createVersion({ documentId, kind: 'manual', state: stateWith('manual') });

		for (let index = 0; index <= MAX_BEFORE_RESTORE_VERSIONS; index++) {
			await keepBeforeRestore({
				documentId,
				state: stateWith(`before ${index}`),
				createdBy: owner.id,
			});
		}

		const versions = await listVersions(documentId);
		expect(versions.filter(({ kind }) => kind === 'before-restore')).toHaveLength(
			MAX_BEFORE_RESTORE_VERSIONS,
		);
		expect(versions.filter(({ kind }) => kind === 'manual')).toHaveLength(1);
	});

	it('does not keep what the newest version already has', async () => {
		const { owner, documentId } = await setup();
		const state = stateWith('text');
		const saved = await createVersion({ documentId, kind: 'manual', state });

		const kept = await keepBeforeRestore({
			documentId,
			state,
			createdBy: owner.id,
		});

		expect(kept._id.equals(saved._id)).toBe(true);
		expect(await listVersions(documentId)).toHaveLength(1);
	});
});
