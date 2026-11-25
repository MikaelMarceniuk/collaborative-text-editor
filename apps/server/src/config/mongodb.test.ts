import { describe, expect, it } from 'vitest';

import { collections } from './mongodb.js';

describe('indexes', () => {
	it('indexes documents by member and last update', async () => {
		const indexes = await collections.documents.indexes();

		expect(indexes.map((index) => index.key)).toContainEqual({
			'members.userId': 1,
			updatedAt: -1,
		});
	});
});
