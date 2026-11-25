import { createClient } from 'redis';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { testRedisUrl } from '../test/redis.js';
import { connectToRedis, type RedisConnection } from './redis.js';

describe('connectToRedis', () => {
	it('gives up after the attempts when nothing is listening', async () => {
		// Port 1 is never open: the first connection must fail instead of retrying forever
		await expect(
			connectToRedis('redis://127.0.0.1:1', { maxAttempts: 2, retryDelayMs: 10 }),
		).rejects.toThrow();
	});
});

describe.skipIf(!testRedisUrl)('onReconnect', () => {
	const connections: RedisConnection[] = [];
	afterEach(async () => {
		await Promise.all(connections.splice(0).map((connection) => connection.close()));
	});

	// Closes every connection from the server side, like a Redis restart or a network failure would
	const dropConnections = async () => {
		const admin = createClient({ url: testRedisUrl });
		await admin.connect();
		try {
			await admin.sendCommand(['CLIENT', 'KILL', 'TYPE', 'normal']);
			await admin.sendCommand(['CLIENT', 'KILL', 'TYPE', 'pubsub']);
		} finally {
			await admin.close();
		}
	};

	it('does not call the listener when it connects for the first time', async () => {
		const connection = await connectToRedis(testRedisUrl!);
		connections.push(connection);
		const listener = vi.fn();
		connection.onReconnect(listener);

		await new Promise((resolve) => setTimeout(resolve, 100));

		expect(listener).not.toHaveBeenCalled();
	});

	it('calls the listener once both connections are back after Redis dropped them', async () => {
		const connection = await connectToRedis(testRedisUrl!);
		connections.push(connection);
		const readyWhenCalled: boolean[] = [];
		connection.onReconnect(() =>
			readyWhenCalled.push(connection.pub.isReady && connection.sub.isReady),
		);
		const errors = vi.spyOn(console, 'error').mockImplementation(() => {});

		await dropConnections();

		await vi.waitFor(() => expect(readyWhenCalled).toEqual([true]));
		errors.mockRestore();
	});

	it('stops calling a listener that was removed', async () => {
		const connection = await connectToRedis(testRedisUrl!);
		connections.push(connection);
		const listener = vi.fn();
		connection.onReconnect(listener)();
		const errors = vi.spyOn(console, 'error').mockImplementation(() => {});

		await dropConnections();
		await vi.waitFor(() => expect(connection.pub.isReady && connection.sub.isReady).toBe(true));
		await new Promise((resolve) => setTimeout(resolve, 100));

		expect(listener).not.toHaveBeenCalled();
		errors.mockRestore();
	});
});
