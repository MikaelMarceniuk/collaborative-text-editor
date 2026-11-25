import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { z } from 'zod';

import { env } from '../../config/env.js';
import { collections } from '../../config/mongodb.js';
import { sendShareDocumentEmail } from '../../emails/share-document.js';
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
	// Guests have no email, and their documents are deleted when the guest is abandoned,
	// which would take the shared document away from everyone else
	if (res.locals.user.isAnonymous) {
		res.status(403).json({ error: 'Create an account to share documents' });
		return;
	}

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

	if (invitedUser._id.equals(res.locals.user.id)) {
		res.status(400).json({ error: 'You already own this document' });
		return;
	}

	if (invitedUser.isAnonymous) {
		res.status(400).json({ error: 'Guests cannot be invited' });
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

	const document = await collections.documents.findOne(
		{ _id: res.locals.documentId },
		{ projection: { title: 1 } },
	);

	// Not awaited: the invite is already saved, so a mail failure must not fail the request
	void sendShareDocumentEmail({
		to: invitedUser.email,
		name: invitedUser.name,
		inviterName: res.locals.user.name,
		documentTitle: document?.title ?? 'Untitled document',
		documentUrl: `${env.WEB_URL}/${res.locals.documentId}`,
		role,
	}).catch((error) => {
		// TODO Improve with logs
		console.error('Failed to send share email:', error);
	});

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

// Route params can be typed as string | string[], hence the typeof check
const parseUserId = (value: unknown) =>
	typeof value === 'string' && ObjectId.isValid(value) ? new ObjectId(value) : null;

const updateMemberSchema = z.object({
	role: z.enum(['editor', 'viewer']),
});

documentMembersRouter.patch('/:userId', documentAccess({ minRole: 'owner' }), async (req, res) => {
	const memberId = parseUserId(req.params.userId);
	if (!memberId) {
		res.status(404).json({ error: 'Member not found' });
		return;
	}

	const parsed = updateMemberSchema.safeParse(req.body);
	if (!parsed.success) {
		res.status(400).json({ error: z.prettifyError(parsed.error) });
		return;
	}

	// Only the owner reaches this point, and the owner is the only one with the "owner" role
	if (memberId.equals(res.locals.user.id)) {
		res.status(400).json({ error: "The owner's role cannot be changed" });
		return;
	}

	const { role } = parsed.data;

	const result = await collections.documents.updateOne(
		{ _id: res.locals.documentId, 'members.userId': memberId },
		{ $set: { 'members.$[member].role': role } },
		{ arrayFilters: [{ 'member.userId': memberId }] },
	);

	if (result.matchedCount === 0) {
		res.status(404).json({ error: 'Member not found' });
		return;
	}

	res.json({ member: { userId: memberId, role } });
});

// The owner removes any other member. Anyone else can only remove themself (leave the document).
documentMembersRouter.delete('/:userId', documentAccess(), async (req, res) => {
	const memberId = parseUserId(req.params.userId);
	if (!memberId) {
		res.status(404).json({ error: 'Member not found' });
		return;
	}

	const isSelf = memberId.equals(res.locals.user.id);

	if (res.locals.role !== 'owner' && !isSelf) {
		res.status(403).json({ error: 'Forbidden' });
		return;
	}

	if (res.locals.role === 'owner' && isSelf) {
		res.status(400).json({ error: 'The owner cannot leave the document, delete it instead' });
		return;
	}

	// The role condition makes sure the owner can never be pulled out, whatever the userId
	const result = await collections.documents.updateOne(
		{ _id: res.locals.documentId, 'members.userId': memberId },
		{ $pull: { members: { userId: { $eq: memberId }, role: { $ne: 'owner' } } } },
	);

	if (result.matchedCount === 0) {
		res.status(404).json({ error: 'Member not found' });
		return;
	}

	res.status(204).end();
});
