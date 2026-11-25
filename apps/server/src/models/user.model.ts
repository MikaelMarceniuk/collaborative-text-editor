import type { ObjectId } from 'mongodb';

// Read-only view of Better Auth's "user" collection: only the fields this app reads
export interface UserModel {
	_id: ObjectId;
	name: string;
	email: string;
	image?: string | null;
	isAnonymous?: boolean | null;
}
