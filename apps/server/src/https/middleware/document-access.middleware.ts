import type { RequestHandler } from 'express';
import { ObjectId } from 'mongodb';

import { collections } from '../../config/mongodb.js';
import type { DocumentRole } from '../../models/document.model.js';

declare global {
	namespace Express {
		interface Locals {
			documentId: ObjectId;
			role: DocumentRole;
		}
	}
}

const ROLE_RANK: Record<DocumentRole, number> = { viewer: 0, editor: 1, owner: 2 };

type DocumentAccessOptions = {
	/** Lowest role allowed to pass. Defaults to any member. */
	minRole?: DocumentRole;
};

/**
 * Resolves the document in `:id` and the current user's role in it.
 * - 404 when the id is invalid or the user is not a member (does not reveal that the document exists)
 * - 403 when the user is a member but has a role below `minRole`
 * Needs authMiddleware before it. On success it sets `res.locals.documentId` and `res.locals.role`.
 */
export const documentAccess =
	({ minRole = 'viewer' }: DocumentAccessOptions = {}): RequestHandler =>
	async (req, res, next) => {
		const id = req.params.id;

		if (typeof id !== 'string' || !ObjectId.isValid(id)) {
			res.status(404).json({ error: 'Document not found' });
			return;
		}

		const documentId = new ObjectId(id);
		const userId = new ObjectId(res.locals.user.id);

		const document = await collections.documents.findOne(
			{ _id: documentId, 'members.userId': userId },
			{ projection: { members: 1 } },
		);
		const role = document?.members.find((member) => member.userId.equals(userId))?.role;

		if (!role) {
			res.status(404).json({ error: 'Document not found' });
			return;
		}

		if (ROLE_RANK[role] < ROLE_RANK[minRole]) {
			res.status(403).json({ error: 'Forbidden' });
			return;
		}

		res.locals.documentId = documentId;
		res.locals.role = role;

		next();
	};
