import { setTimeout } from 'node:timers/promises';

import { MongoClient } from 'mongodb';

import type { DocumentModel } from '../models/document.model.js';
import { env } from './env.js';

export const mongoClient = new MongoClient(env.MONGO_URL, {
	serverSelectionTimeoutMS: 5000,
});

export const db = mongoClient.db();

export const collections = {
	documents: db.collection<DocumentModel>('documents'),
};

export async function connectToMongo(maxAttempts = 3, delayMs = 2000) {
	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		try {
			await mongoClient.connect();
			await db.command({ ping: 1 });
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
