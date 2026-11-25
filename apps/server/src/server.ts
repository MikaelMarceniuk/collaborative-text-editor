import { createServer } from 'node:http';

import { app } from './app.js';
import { env } from './config/env.js';
import { connectToMongo, mongoClient } from './config/mongodb.js';
import { connectToRedis } from './config/redis.js';
import { inviteRateLimitStore } from './https/middleware/invite-rate-limit.middleware.js';
import { scheduleCleanupAbandonedGuests } from './jobs/cleanup-abandoned-guests.job.js';
import { createSocketServer } from './realtime/socket-server.js';

try {
	await connectToMongo();
} catch {
	console.error('Could not connect to MongoDB, shutting down');
	process.exit(1);
}

// Optional: without REDIS_URL this is the only instance and nothing tries to reach Redis
let redis: Awaited<ReturnType<typeof connectToRedis>> | undefined;
if (env.REDIS_URL) {
	try {
		redis = await connectToRedis(env.REDIS_URL);
		inviteRateLimitStore.useRedis(redis.pub);
	} catch {
		console.error('Could not connect to Redis, shutting down');
		process.exit(1);
	}
}

const stopCleanupAbandonedGuests = scheduleCleanupAbandonedGuests();

const httpServer = createServer(app);
const socketServer = createSocketServer(httpServer, { redis });

httpServer.listen(env.PORT, () => {
	console.log(`Server running on http://localhost:${env.PORT}`);
});

async function shutdown(signal: NodeJS.Signals) {
	console.log(`${signal} received, shutting down`);
	stopCleanupAbandonedGuests();

	try {
		// Disconnects every socket and closes the HTTP server: server.close() alone would wait for them forever
		await socketServer.close();
		await redis?.close();
		await mongoClient.close();
		process.exit(0);
	} catch (error) {
		console.error('Error during shutdown:', error);
		process.exit(1);
	}
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
