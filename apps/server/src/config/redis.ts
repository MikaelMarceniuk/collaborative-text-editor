import { createClient } from 'redis';

/**
 * The two connections the Socket.IO Redis adapter needs: one publishes, the other is in subscriber mode
 * (a subscribed connection cannot run other commands). Redis is only a message bus between server instances
 * (see docs/redis.md), so nothing is kept in it.
 */
export interface RedisConnection {
	pub: ReturnType<typeof createRedisClient>;
	sub: ReturnType<typeof createRedisClient>;
	/** Closes both connections. Safe to call when they are already closed. */
	close: () => Promise<void>;
}

interface ConnectToRedisOptions {
	/** How many times to try before giving up on the first connection. */
	maxAttempts?: number;
	retryDelayMs?: number;
}

const createRedisClient = (
	url: string,
	{ maxAttempts, retryDelayMs }: Required<ConnectToRedisOptions>,
) => {
	let connectedOnce = false;
	const client = createClient({
		url,
		socket: {
			reconnectStrategy: (retries, cause) => {
				if (!connectedOnce) return retries + 1 >= maxAttempts ? cause : retryDelayMs;
				return Math.min(retries * 200, 5000);
			},
		},
	});

	client.on('ready', () => {
		connectedOnce = true;
	});
	// Without a listener, an "error" event would crash the process
	client.on('error', (error: unknown) => {
		// TODO Improve with logs
		console.error('Redis error:', error instanceof Error ? error.message : error);
	});

	return client;
};

/**
 * Connects the two clients. The first connection gives up after maxAttempts, so a wrong URL fails the startup
 * (like Mongo does). Once connected, a lost connection is retried forever with a growing delay: the instances
 * keep working on their own meanwhile, and the rooms catch up when Redis is back.
 */
export const connectToRedis = async (
	url: string,
	{ maxAttempts = 3, retryDelayMs = 1000 }: ConnectToRedisOptions = {},
): Promise<RedisConnection> => {
	const pub = createRedisClient(url, { maxAttempts, retryDelayMs });
	const sub = createRedisClient(url, { maxAttempts, retryDelayMs });

	const close = async () => {
		await Promise.all(
			[pub, sub].map(async (client) => {
				if (!client.isOpen) return;
				try {
					await client.close();
				} catch {
					client.destroy();
				}
			}),
		);
	};

	try {
		await Promise.all([pub.connect(), sub.connect()]);
	} catch (error) {
		await close();
		throw error;
	}

	console.log('Redis connected');
	return { pub, sub, close };
};
