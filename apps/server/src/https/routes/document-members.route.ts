import { Router } from 'express';

import { collections } from '../../config/mongodb.js';
import type { DocumentRole } from '../../models/document.model.js';
import { documentAccess } from '../middleware/document-access.middleware.js';

// Mounted at /api/documents/:id/members. authMiddleware is applied by the parent router.
export const documentMembersRouter = Router({ mergeParams: true });

documentMembersRouter.get('/', documentAccess(), async (_req, res) => {
	// The document only keeps the userId of each member, so name and email come from Better Auth's "user" collection
	const members = await collections.documents
		.aggregate<{ userId: string; role: DocumentRole; name: string; email: string; image?: string }>(
			[
				{ $match: { _id: res.locals.documentId } },
				{ $unwind: '$members' },
				{
					$lookup: {
						from: 'user',
						localField: 'members.userId',
						foreignField: '_id',
						as: 'user',
					},
				},
				{ $unwind: '$user' },
				{
					$project: {
						_id: 0,
						userId: '$members.userId',
						role: '$members.role',
						name: '$user.name',
						email: '$user.email',
						image: '$user.image',
					},
				},
			],
		)
		.toArray();

	// Owner first. Array.sort is stable, so the others keep the order they were added in
	members.sort((a, b) => Number(b.role === 'owner') - Number(a.role === 'owner'));

	res.json({ members });
});
