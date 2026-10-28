import { app } from './app.js';
import { env } from './config/env.js';
import { connectToMongo, mongoClient } from './config/mongodb.js';
import { scheduleCleanupAbandonedGuests } from './jobs/cleanup-abandoned-guests.job.js';

try {
	await connectToMongo();
} catch {
	console.error('Could not connect to MongoDB, shutting down');
	process.exit(1);
}

const stopCleanupAbandonedGuests = scheduleCleanupAbandonedGuests();

const server = app.listen(env.PORT, () => {
	console.log(`Server running on http://localhost:${env.PORT}`);
});

async function shutdown(signal: NodeJS.Signals) {
	console.log(`${signal} received, shutting down`);
	stopCleanupAbandonedGuests();

	try {
		await new Promise<void>((resolve, reject) => {
			server.close((error) => (error ? reject(error) : resolve()));
		});
		await mongoClient.close();
		process.exit(0);
	} catch (error) {
		console.error('Error during shutdown:', error);
		process.exit(1);
	}
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
