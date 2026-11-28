import type { Binary, ObjectId } from 'mongodb';

export type DocumentRole = 'owner' | 'editor' | 'viewer';

export interface DocumentMember {
	userId: ObjectId;
	role: DocumentRole;
}

export interface DocumentModel {
	_id: ObjectId;
	title: string;
	ownerId: ObjectId;
	members: DocumentMember[];
	ydocState?: Binary;
	contentVersion?: number;
	/** The plain text of the content, for the search index (see docs/search.md). Absent until the first save. */
	searchText?: string;
	/** When the last automatic version was claimed (see docs/versions.md). */
	versionedAt?: Date;
	createdAt: Date;
	updatedAt: Date;
}
