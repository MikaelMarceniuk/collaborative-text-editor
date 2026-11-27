import { Binary, ObjectId } from 'mongodb';
import * as Y from 'yjs';

import { collections } from '../config/mongodb.js';
import type {
	DocumentVersionKind,
	DocumentVersionModel,
} from '../models/document-version.model.js';
import { CONTENT_FIELD } from './document-content.service.js';

/** An automatic version is made when the last one is older than this. */
export const AUTO_VERSION_INTERVAL_MS = 10 * 60 * 1000;
/** How many automatic versions a document keeps. Manual and before-restore ones are never removed. */
export const MAX_AUTO_VERSIONS = 50;

export type DocumentVersionSummary = Omit<DocumentVersionModel, 'snapshot'>;

/** A document nobody wrote in has nothing worth keeping. */
const hasContent = (state: Uint8Array) => {
	const ydoc = new Y.Doc();
	Y.applyUpdate(ydoc, state);

	return ydoc.getXmlFragment(CONTENT_FIELD).length > 0;
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

	return version;
};

/** The newest first, without the snapshots. */
export const listVersions = (documentId: ObjectId) =>
	collections.documentVersions
		.find({ documentId })
		.project<DocumentVersionSummary>({ snapshot: 0 })
		.sort({ createdAt: -1 })
		.toArray();

/** Null when the version does not exist or belongs to another document. */
export const getVersion = (documentId: ObjectId, versionId: ObjectId) =>
	collections.documentVersions.findOne({ _id: versionId, documentId });

export const deleteVersionsOf = async (documentIds: ObjectId | ObjectId[]) => {
	const ids = Array.isArray(documentIds) ? documentIds : [documentIds];

	await collections.documentVersions.deleteMany({ documentId: { $in: ids } });
};

// Keeps the newest MAX_AUTO_VERSIONS automatic versions of the document
const trimAutoVersions = async (documentId: ObjectId) => {
	const surplus = await collections.documentVersions
		.find({ documentId, kind: 'auto' })
		.project<{ _id: ObjectId }>({ _id: 1 })
		.sort({ createdAt: -1 })
		.skip(MAX_AUTO_VERSIONS)
		.toArray();

	if (surplus.length === 0) return;

	await collections.documentVersions.deleteMany({ _id: { $in: surplus.map(({ _id }) => _id) } });
};

type createAutoVersionParams = {
	documentId: ObjectId;
	/** The state of the room, which may be ahead of Mongo. */
	state: Uint8Array;
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
	state,
	when,
	now = new Date(),
}: createAutoVersionParams) => {
	if (!hasContent(state)) return null;

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

	const version = await createVersion({ documentId, kind: 'auto', state });
	await trimAutoVersions(documentId);

	return version;
};
