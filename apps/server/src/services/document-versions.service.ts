import { Binary, ObjectId } from 'mongodb';
import * as Y from 'yjs';

import { collections } from '../config/mongodb.js';
import type {
	DocumentVersionKind,
	DocumentVersionModel,
} from '../models/document-version.model.js';
import { CONTENT_FIELD } from './document-content.service.js';

/** A document nobody wrote in has nothing worth keeping. */
export const hasContent = (state: Uint8Array) => {
	const ydoc = new Y.Doc();
	Y.applyUpdate(ydoc, state);

	return ydoc.getXmlFragment(CONTENT_FIELD).length > 0;
};

/** An automatic version is made when the last one is older than this. */
export const AUTO_VERSION_INTERVAL_MS = 10 * 60 * 1000;
/** How many automatic versions a document keeps. */
export const MAX_AUTO_VERSIONS = 50;
/** The ones kept before a restore are a safety net, not something a person chose. */
export const MAX_BEFORE_RESTORE_VERSIONS = 10;
// Manual versions are never removed: a person chose to keep them
const MAX_VERSIONS_OF_KIND: Partial<Record<DocumentVersionKind, number>> = {
	auto: MAX_AUTO_VERSIONS,
	'before-restore': MAX_BEFORE_RESTORE_VERSIONS,
};

export type DocumentVersionSummary = Omit<DocumentVersionModel, 'snapshot'>;

// Keeps the newest versions of that kind, up to the limit it has (none for the manual ones)
const trimVersions = async (documentId: ObjectId, kind: DocumentVersionKind) => {
	const max = MAX_VERSIONS_OF_KIND[kind];
	if (max === undefined) return;

	const surplus = await collections.documentVersions
		.find({ documentId, kind })
		.project<{ _id: ObjectId }>({ _id: 1 })
		.sort({ createdAt: -1, _id: -1 })
		.skip(max)
		.toArray();

	if (surplus.length === 0) return;

	await collections.documentVersions.deleteMany({ _id: { $in: surplus.map(({ _id }) => _id) } });
};

type createVersionParams = {
	documentId: ObjectId;
	kind: DocumentVersionKind;
	state: Uint8Array;
	label?: string;
	createdBy?: ObjectId;
};

export const createVersion = async ({
	documentId,
	kind,
	state,
	label,
	createdBy,
}: createVersionParams) => {
	const version: DocumentVersionModel = {
		_id: new ObjectId(),
		documentId,
		kind,
		...(label !== undefined && { label }),
		snapshot: new Binary(state),
		size: state.byteLength,
		...(createdBy && { createdBy }),
		createdAt: new Date(),
	};

	await collections.documentVersions.insertOne(version);
	await trimVersions(documentId, kind);

	return version;
};

/** The newest first, without the snapshots. */
export const listVersions = (documentId: ObjectId) =>
	collections.documentVersions
		.find({ documentId })
		.project<DocumentVersionSummary>({ snapshot: 0 })
		// The _id breaks the tie between two versions made in the same millisecond
		.sort({ createdAt: -1, _id: -1 })
		.toArray();

/** Null when the version does not exist or belongs to another document. */
export const getVersion = (documentId: ObjectId, versionId: ObjectId) =>
	collections.documentVersions.findOne({ _id: versionId, documentId });

export const deleteVersionsOf = async (documentIds: ObjectId | ObjectId[]) => {
	const ids = Array.isArray(documentIds) ? documentIds : [documentIds];

	await collections.documentVersions.deleteMany({ documentId: { $in: ids } });
};

type createAutoVersionParams = {
	documentId: ObjectId;
	/** The state of the room, which may be ahead of Mongo. Only called when the version is going to be made. */
	getState: () => Uint8Array;
	/**
	 * - "due": the last version is older than AUTO_VERSION_INTERVAL_MS (or there is none). After a save.
	 * - "changed": the document was saved after the last version, however recent. When the last person leaves.
	 */
	when: 'due' | 'changed';
	now?: Date;
};

/**
 * Creates an automatic version if the rule of `when` says so. The right to create it is claimed with an atomic
 * update of `versionedAt`, so two instances saving the same document at the same time make one version, not two.
 * Returns the version, or null when there was nothing to do.
 */
export const createAutoVersionIfDue = async ({
	documentId,
	getState,
	when,
	now = new Date(),
}: createAutoVersionParams) => {
	const rule =
		when === 'due'
			? { versionedAt: { $lt: new Date(now.getTime() - AUTO_VERSION_INTERVAL_MS) } }
			: { $expr: { $lt: ['$versionedAt', '$updatedAt'] } };

	const claimed = await collections.documents.findOneAndUpdate(
		{ _id: documentId, $or: [{ versionedAt: { $exists: false } }, rule] },
		{ $set: { versionedAt: now } },
		{ projection: { _id: 1 } },
	);
	if (!claimed) return null;

	return createVersion({ documentId, kind: 'auto', state: getState() });
};

// The same document can be encoded in different bytes (updates merged by Mongo against the encoding of a Y.Doc),
// so two states are compared after both go through a Y.Doc
const normalize = (state: Uint8Array) => {
	const ydoc = new Y.Doc();
	Y.applyUpdate(ydoc, state);

	return Y.encodeStateAsUpdate(ydoc);
};

const sameState = (a: Uint8Array, b: Uint8Array) => Buffer.from(normalize(a)).equals(normalize(b));

const latestVersion = (documentId: ObjectId) =>
	collections.documentVersions.findOne({ documentId }, { sort: { createdAt: -1, _id: -1 } });

type saveManualVersionParams = {
	documentId: ObjectId;
	state: Uint8Array;
	label?: string;
	createdBy: ObjectId;
};

/**
 * Keeps the document as it is now, on a person's request. When nothing changed since the newest version, no new one
 * is made: pressing "save" again and again would only fill the database with copies of the same text. If the person
 * gave a name that version does not have, it is that version that gets the name (and stops being removable).
 * Returns the version, and whether it was created now.
 */
export const saveManualVersion = async ({
	documentId,
	state,
	label,
	createdBy,
}: saveManualVersionParams) => {
	const latest = await latestVersion(documentId);

	if (!latest || !sameState(latest.snapshot.buffer, state)) {
		const version = await createVersion({ documentId, kind: 'manual', state, label, createdBy });

		return { version, created: true };
	}

	if (!label || latest.label === label) return { version: latest, created: false };

	const named = await collections.documentVersions.findOneAndUpdate(
		{ _id: latest._id },
		{ $set: { kind: 'manual', label, createdBy } },
		{ returnDocument: 'after' },
	);

	return { version: named ?? latest, created: false };
};

/**
 * Keeps what the document has before a restore replaces it, unless the newest version already has exactly that
 * (a restore right after another one, or right after a version was saved).
 */
export const keepBeforeRestore = async ({
	documentId,
	state,
	createdBy,
}: Omit<saveManualVersionParams, 'label'>) => {
	const latest = await latestVersion(documentId);
	if (latest && sameState(latest.snapshot.buffer, state)) return latest;

	return createVersion({ documentId, kind: 'before-restore', state, createdBy });
};
