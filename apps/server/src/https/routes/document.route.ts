import { raw, Router } from 'express';
import { ObjectId } from 'mongodb';
import { z } from 'zod';

import { collections } from '../../config/mongodb.js';
import type { DocumentModel, DocumentRole } from '../../models/document.model.js';
import {
	applyDocumentUpdate,
	InvalidDocumentUpdateError,
	loadDocumentState,
} from '../../services/document-content.service.js';
import { authMiddleware } from '../middleware/auth.middleware.js';

export const documentRouter = Router();

documentRouter.use(authMiddleware);

const documentBodySchema = z.object({
	title: z.string().trim().min(1).max(200),
});

function parseDocumentId(id: string) {
	return ObjectId.isValid(id) ? new ObjectId(id) : null;
}

async function findMemberRole(documentId: ObjectId, userId: ObjectId) {
	const document = await collections.documents.findOne(
		{ _id: documentId, 'members.userId': userId },
		{ projection: { members: 1 } },
	);

	return document?.members.find((member) => member.userId.equals(userId))?.role ?? null;
}

const canEdit = (role: DocumentRole) => role === 'owner' || role === 'editor';

documentRouter.get('/', async (_req, res) => {
	const userId = new ObjectId(res.locals.user.id);

	const documents = await collections.documents
		.find({ 'members.userId': userId })
		.project<Omit<DocumentModel, 'ydocState'>>({ ydocState: 0 })
		.sort({ updatedAt: -1 })
		.toArray();

	res.json({ documents });
});

documentRouter.get('/:id', async (req, res) => {
	const documentId = parseDocumentId(req.params.id);
	if (!documentId) {
		res.status(404).json({ error: 'Document not found' });
		return;
	}

	const userId = new ObjectId(res.locals.user.id);

	const document = await collections.documents.findOne(
		{ _id: documentId, 'members.userId': userId },
		{ projection: { ydocState: 0 } },
	);

	if (!document) {
		res.status(404).json({ error: 'Document not found' });
		return;
	}

	res.json({ document });
});

documentRouter.get('/:id/content', async (req, res) => {
	const documentId = parseDocumentId(req.params.id);
	if (!documentId) {
		res.status(404).json({ error: 'Document not found' });
		return;
	}

	const userId = new ObjectId(res.locals.user.id);
	const role = await findMemberRole(documentId, userId);
	if (!role) {
		res.status(404).json({ error: 'Document not found' });
		return;
	}

	const state = await loadDocumentState(documentId);

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
	raw({ type: 'application/octet-stream', limit: '2mb' }),
	async (req, res) => {
		if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
			res.status(400).json({ error: 'No content found' });
			return;
		}

		const documentId = parseDocumentId(req.params.id);
		if (!documentId) {
			res.status(404).json({ error: 'Document not found' });
			return;
		}

		const userId = new ObjectId(res.locals.user.id);
		const role = await findMemberRole(documentId, userId);
		if (!role) {
			res.status(404).json({ error: 'Document not found' });
			return;
		}

		if (!canEdit(role)) {
			res.status(403).json({ error: 'Not enough permissions.' });
			return;
		}

		try {
			await applyDocumentUpdate({ documentId, update: req.body });
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

documentRouter.patch('/:id', async (req, res) => {
	const documentId = parseDocumentId(req.params.id);
	if (!documentId) {
		res.status(404).json({ error: 'Document not found' });
		return;
	}

	const parsed = documentBodySchema.safeParse(req.body);
	if (!parsed.success) {
		res.status(400).json({ error: z.prettifyError(parsed.error) });
		return;
	}

	const userId = new ObjectId(res.locals.user.id);

	const role = await findMemberRole(documentId, userId);
	if (!role) {
		res.status(404).json({ error: 'Document not found' });
		return;
	}
	if (!canEdit(role)) {
		res.status(403).json({ error: 'Forbidden' });
		return;
	}

	const document = await collections.documents.findOneAndUpdate(
		{ _id: documentId },
		{ $set: { title: parsed.data.title, updatedAt: new Date() } },
		{ returnDocument: 'after', projection: { ydocState: 0 } },
	);

	if (!document) {
		res.status(404).json({ error: 'Document not found' });
		return;
	}

	res.json({ document });
});

documentRouter.delete('/:id', async (req, res) => {
	const documentId = parseDocumentId(req.params.id);
	if (!documentId) {
		res.status(404).json({ error: 'Document not found' });
		return;
	}

	const userId = new ObjectId(res.locals.user.id);

	const role = await findMemberRole(documentId, userId);
	if (!role) {
		res.status(404).json({ error: 'Document not found' });
		return;
	}
	if (role !== 'owner') {
		res.status(403).json({ error: 'Forbidden' });
		return;
	}

	await collections.documents.deleteOne({ _id: documentId });

	res.status(204).end();
});
