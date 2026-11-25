import { raw, Router } from 'express';
import { ObjectId } from 'mongodb';
import { z } from 'zod';

import { collections } from '../../config/mongodb.js';
import type { DocumentModel } from '../../models/document.model.js';
import {
	applyDocumentUpdate,
	InvalidDocumentUpdateError,
	loadDocumentState,
} from '../../services/document-content.service.js';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { documentAccess } from '../middleware/document-access.middleware.js';
import { documentMembersRouter } from './document-members.route.js';

export const documentRouter = Router();

documentRouter.use(authMiddleware);
documentRouter.use('/:id/members', documentMembersRouter);

const documentBodySchema = z.object({
	title: z.string().trim().min(1).max(200),
});

documentRouter.get('/', async (_req, res) => {
	const userId = new ObjectId(res.locals.user.id);

	const documents = await collections.documents
		.find({ 'members.userId': userId })
		.project<Omit<DocumentModel, 'ydocState'>>({ ydocState: 0 })
		.sort({ updatedAt: -1 })
		.toArray();

	res.json({ documents });
});

documentRouter.get('/:id', documentAccess(), async (_req, res) => {
	const document = await collections.documents.findOne(
		{ _id: res.locals.documentId },
		{ projection: { ydocState: 0 } },
	);

	if (!document) {
		res.status(404).json({ error: 'Document not found' });
		return;
	}

	res.json({ document });
});

documentRouter.get('/:id/content', documentAccess(), async (_req, res) => {
	const state = await loadDocumentState(res.locals.documentId);

	res.type('application/octet-stream').send(Buffer.from(state));
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

documentRouter.post(
	'/:id/updates',
	documentAccess({ minRole: 'editor' }),
	raw({ type: 'application/octet-stream', limit: '2mb' }),
	async (req, res) => {
		if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
			res.status(400).json({ error: 'No content found' });
			return;
		}

		try {
			await applyDocumentUpdate({ documentId: res.locals.documentId, update: req.body });
			res.status(204).end();
		} catch (error) {
			if (error instanceof InvalidDocumentUpdateError) {
				res.status(400).json({ error: 'Invalid document.' });
				return;
			}
			throw error;
		}
	},
);

documentRouter.patch('/:id', documentAccess({ minRole: 'editor' }), async (req, res) => {
	const parsed = documentBodySchema.safeParse(req.body);
	if (!parsed.success) {
		res.status(400).json({ error: z.prettifyError(parsed.error) });
		return;
	}

	const document = await collections.documents.findOneAndUpdate(
		{ _id: res.locals.documentId },
		{ $set: { title: parsed.data.title, updatedAt: new Date() } },
		{ returnDocument: 'after', projection: { ydocState: 0 } },
	);

	if (!document) {
		res.status(404).json({ error: 'Document not found' });
		return;
	}

	res.json({ document });
});

documentRouter.delete('/:id', documentAccess({ minRole: 'owner' }), async (_req, res) => {
	await collections.documents.deleteOne({ _id: res.locals.documentId });

	res.status(204).end();
});
