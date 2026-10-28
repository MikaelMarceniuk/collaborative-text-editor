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
	createdAt: Date;
	updatedAt: Date;
}
