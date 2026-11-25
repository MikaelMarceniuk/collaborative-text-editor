import { Router } from 'express';
import { z } from 'zod';

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

const addMemberSchema = z.object({
	email: z.string().trim().toLowerCase().pipe(z.email()),
	// Never "owner": there is a single owner, set when the document is created
	role: z.enum(['editor', 'viewer']),
});

documentMembersRouter.post('/', documentAccess({ minRole: 'owner' }), async (req, res) => {
	const parsed = addMemberSchema.safeParse(req.body);
	if (!parsed.success) {
		res.status(400).json({ error: z.prettifyError(parsed.error) });
		return;
	}

	const { email, role } = parsed.data;

	const invitedUser = await collections.users.findOne({ email });
	if (!invitedUser) {
		res.status(404).json({ error: 'No user with this email' });
		return;
	}

	// The filter and the $push are one atomic operation, so two simultaneous invites
	// for the same user cannot both add them
	const result = await collections.documents.updateOne(
		{ _id: res.locals.documentId, 'members.userId': { $ne: invitedUser._id } },
		{ $push: { members: { userId: invitedUser._id, role } } },
	);

	if (result.matchedCount === 0) {
		res.status(409).json({ error: 'This user already has access to the document' });
		return;
	}

	res.status(201).json({
		member: {
			userId: invitedUser._id,
			role,
			name: invitedUser.name,
			email: invitedUser.email,
			image: invitedUser.image ?? undefined,
		},
	});
});
