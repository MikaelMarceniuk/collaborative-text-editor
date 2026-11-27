import type { Binary, ObjectId } from 'mongodb';

export type DocumentVersionKind = 'auto' | 'manual' | 'before-restore';

export interface DocumentVersionModel {
	_id: ObjectId;
	documentId: ObjectId;
	kind: DocumentVersionKind;
	/** Only on manual versions. */
	label?: string;
	/** The whole Y.Doc state at that moment (Y.encodeStateAsUpdate). */
	snapshot: Binary;
	/** Bytes of the snapshot, so the list does not need to load it. */
	size: number;
	/** Absent on the versions the server creates by itself. */
	createdBy?: ObjectId;
	createdAt: Date;
}
