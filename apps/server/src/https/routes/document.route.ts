import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { z } from 'zod';

import { collections } from '../../config/mongodb.js';
import type { DocumentModel } from '../../models/document.model.js';
import { accessNotifier } from '../../realtime/access-notifier.js';
import { deleteVersionsOf } from '../../services/document-versions.service.js';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { documentAccess } from '../middleware/document-access.middleware.js';
import { documentMembersRouter } from './document-members.route.js';
import { documentVersionsRouter } from './document-versions.route.js';

// What a client never needs: the binary content and the text copy kept for the search
const HIDDEN_FIELDS = { ydocState: 0, searchText: 0 } as const;
type DocumentSummary = Omit<DocumentModel, 'ydocState' | 'searchText'>;

export const documentRouter = Router();

documentRouter.use(authMiddleware);
documentRouter.use('/:id/members', documentMembersRouter);
documentRouter.use('/:id/versions', documentVersionsRouter);

const documentBodySchema = z.object({
	title: z.string().trim().min(1).max(200),
});

documentRouter.get('/', async (_req, res) => {
	const userId = new ObjectId(res.locals.user.id);

	const documents = await collections.documents
		.find({ 'members.userId': userId })
		.project<DocumentSummary>(HIDDEN_FIELDS)
		.sort({ updatedAt: -1 })
		.toArray();

	res.json({ documents });
});

documentRouter.get('/:id', documentAccess(), async (_req, res) => {
	const document = await collections.documents.findOne(
		{ _id: res.locals.documentId },
		{ projection: HIDDEN_FIELDS },
	);

	if (!document) {
		res.status(404).json({ error: 'Document not found' });
		return;
	}

	res.json({ document });
});

documentRouter.post('/', async (_req, res) => {
	const userId = new ObjectId(res.locals.user.id);
	const now = new Date();

	const document: DocumentModel = {
		_id: new ObjectId(),
		title: 'Untitled document',
		ownerId: userId,
		members: [{ userId, role: 'owner' }],
		contentVersion: 0,
		createdAt: now,
		updatedAt: now,
	};

	await collections.documents.insertOne(document);

	res.status(201).json({ document });
});

documentRouter.patch('/:id', documentAccess({ minRole: 'editor' }), async (req, res) => {
	const parsed = documentBodySchema.safeParse(req.body);
	if (!parsed.success) {
		res.status(400).json({ error: z.prettifyError(parsed.error) });
		return;
	}

	const document = await collections.documents.findOneAndUpdate(
		{ _id: res.locals.documentId },
		{ $set: { title: parsed.data.title, updatedAt: new Date() } },
		{ returnDocument: 'after', projection: HIDDEN_FIELDS },
	);

	if (!document) {
		res.status(404).json({ error: 'Document not found' });
		return;
	}

	res.json({ document });
});

documentRouter.delete('/:id', documentAccess({ minRole: 'owner' }), async (_req, res) => {
	await collections.documents.deleteOne({ _id: res.locals.documentId });
	await deleteVersionsOf(res.locals.documentId);
	await accessNotifier.documentDeleted(res.locals.documentId);

	res.status(204).end();
});
