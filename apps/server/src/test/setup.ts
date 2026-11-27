import { afterAll, beforeAll, beforeEach } from 'vitest';

import { collections, connectToMongo, db, mongoClient } from '../config/mongodb.js';

beforeAll(async () => {
	// The tests delete everything, so refuse to run against anything that is not a test database
	if (!db.databaseName.endsWith('-test')) {
		throw new Error(
			`Refusing to run tests on database "${db.databaseName}": name must end with "-test"`,
		);
	}

	await connectToMongo(1);
});

beforeEach(async () => {
	await collections.documents.deleteMany({});
	await collections.documentVersions.deleteMany({});
	await db.collection('user').deleteMany({});
});

afterAll(async () => {
	await mongoClient.close();
});
