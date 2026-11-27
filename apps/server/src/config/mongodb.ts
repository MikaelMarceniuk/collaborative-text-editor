import { setTimeout } from 'node:timers/promises';

import { MongoClient } from 'mongodb';

import type { DocumentVersionModel } from '../models/document-version.model.js';
import type { DocumentModel } from '../models/document.model.js';
import type { UserModel } from '../models/user.model.js';
import { env } from './env.js';

export const mongoClient = new MongoClient(env.MONGO_URL, {
	serverSelectionTimeoutMS: 5000,
});

export const db = mongoClient.db();

export const collections = {
	documents: db.collection<DocumentModel>('documents'),
	documentVersions: db.collection<DocumentVersionModel>('document_versions'),
	// Owned by Better Auth: only read from here, never write
	users: db.collection<UserModel>('user'),
};

// createIndex is idempotent: it does nothing when the index already exists
export async function ensureIndexes() {
	// Serves the documents list: filter by member, newest first
	await collections.documents.createIndex({ 'members.userId': 1, updatedAt: -1 });
	// Serves the version list of a document, newest first, and the retention of the automatic ones
	await collections.documentVersions.createIndex({ documentId: 1, createdAt: -1 });
}

export async function connectToMongo(maxAttempts = 3, delayMs = 2000) {
	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		try {
			await mongoClient.connect();
			await db.command({ ping: 1 });
			await ensureIndexes();
			console.log(`MongoDB connected to database "${db.databaseName}"`);
			return;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			console.error(`MongoDB connection failed (attempt ${attempt}/${maxAttempts}): ${message}`);
			if (attempt === maxAttempts) throw error;
			await setTimeout(delayMs);
		}
	}
}
