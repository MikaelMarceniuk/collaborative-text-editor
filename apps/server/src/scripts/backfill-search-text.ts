import { connectToMongo, mongoClient } from '../config/mongodb.js';
import { backfillSearchText } from '../services/backfill-search-text.js';

// Run once after deploying the search, see docs/search.md. Safe to run again.
try {
	await connectToMongo();
	const { updated, skipped } = await backfillSearchText();
	console.log(
		`Search text filled in ${updated} documents (${skipped} changed meanwhile, skipped).`,
	);
} catch (error) {
	console.error('Backfill failed:', error);
	process.exitCode = 1;
} finally {
	await mongoClient.close();
}
