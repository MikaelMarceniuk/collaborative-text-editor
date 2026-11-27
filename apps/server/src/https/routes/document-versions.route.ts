import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { z } from 'zod';

import { collections } from '../../config/mongodb.js';
import { liveContent } from '../../realtime/live-content.js';
import {
	createVersion,
	getVersion,
	hasContent,
	listVersions,
} from '../../services/document-versions.service.js';
import { documentAccess } from '../middleware/document-access.middleware.js';
import { versionRateLimit } from '../middleware/version-rate-limit.middleware.js';

// Mounted at /api/documents/:id/versions. authMiddleware is applied by the parent router.
export const documentVersionsRouter = Router({ mergeParams: true });

const createVersionSchema = z.object({
	// An empty label is the same as none
	label: z
		.string()
		.trim()
		.max(100)
		.transform((label) => label || undefined)
		.optional(),
});

// Route params can be typed as string | string[], hence the typeof check
const parseVersionId = (value: unknown) =>
	typeof value === 'string' && ObjectId.isValid(value) ? new ObjectId(value) : null;

documentVersionsRouter.get('/', documentAccess(), async (_req, res) => {
	const versions = await listVersions(res.locals.documentId);

	// Who made it: the name comes from Better Auth's "user" collection. Someone who no longer exists has no name
	const authorIds = [
		...new Map(
			versions.flatMap(({ createdBy }) =>
				createdBy ? [[createdBy.toHexString(), createdBy]] : [],
			),
		).values(),
	];
	const authors = await collections.users.find({ _id: { $in: authorIds } }).toArray();
	const names = new Map(authors.map((author) => [author._id.toHexString(), author.name]));

	res.json({
		versions: versions.map(({ createdBy, ...version }) => ({
			...version,
			createdBy: createdBy
				? { userId: createdBy, name: names.get(createdBy.toHexString()) ?? null }
				: null,
		})),
	});
});

documentVersionsRouter.get('/:versionId', documentAccess(), async (req, res) => {
	const versionId = parseVersionId(req.params.versionId);
	const version = versionId && (await getVersion(res.locals.documentId, versionId));

	if (!version) {
		res.status(404).json({ error: 'Version not found' });
		return;
	}

	const { snapshot, ...summary } = version;

	// base64, like everywhere else the binary has to travel inside JSON (see docs/redis.md)
	res.json({ version: summary, snapshot: Buffer.from(snapshot.buffer).toString('base64') });
});

documentVersionsRouter.post(
	'/',
	versionRateLimit,
	documentAccess({ minRole: 'editor' }),
	async (req, res) => {
		const parsed = createVersionSchema.safeParse(req.body ?? {});
		if (!parsed.success) {
			res.status(400).json({ error: z.prettifyError(parsed.error) });
			return;
		}

		// What the editors have right now, which may be ahead of what is saved
		const state = await liveContent.currentState(res.locals.documentId);
		if (!hasContent(state)) {
			res.status(400).json({ error: 'The document is empty' });
			return;
		}

		const { snapshot: _snapshot, ...version } = await createVersion({
			documentId: res.locals.documentId,
			kind: 'manual',
			state,
			label: parsed.data.label,
			createdBy: new ObjectId(res.locals.user.id),
		});

		res.status(201).json({ version });
	},
);

documentVersionsRouter.post(
	'/:versionId/restore',
	versionRateLimit,
	documentAccess({ minRole: 'editor' }),
	async (req, res) => {
		const versionId = parseVersionId(req.params.versionId);
		const version = versionId && (await getVersion(res.locals.documentId, versionId));

		if (!version) {
			res.status(404).json({ error: 'Version not found' });
			return;
		}

		// So that restoring can be undone. A document with nothing in it has nothing to lose
		const current = await liveContent.currentState(res.locals.documentId);
		if (hasContent(current)) {
			await createVersion({
				documentId: res.locals.documentId,
				kind: 'before-restore',
				state: current,
				createdBy: new ObjectId(res.locals.user.id),
			});
		}

		await liveContent.restore(res.locals.documentId, version.snapshot.buffer);

		res.status(204).end();
	},
);
