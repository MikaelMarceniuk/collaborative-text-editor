import { randomUUID } from 'node:crypto';

import type { Options } from 'express-rate-limit';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { connectToRedis, type RedisConnection } from '../../config/redis.js';
import { testRedisUrl } from '../../test/redis.js';
import { SwitchableRateLimitStore } from './switchable-rate-limit-store.js';

const options = { windowMs: 60_000 } as Options;

const startStore = (redis?: RedisConnection['pub']) => {
	const store = new SwitchableRateLimitStore('rl:test:');
	store.init(options);
	if (redis) store.useRedis(redis);
	return store;
};

const stores: SwitchableRateLimitStore[] = [];
afterEach(() => {
	for (const store of stores.splice(0)) store.shutdown();
});

describe('rate limit store without Redis', () => {
	it('counts in memory', async () => {
		const store = startStore();
		stores.push(store);

		expect((await store.increment('someone')).totalHits).toBe(1);
		expect((await store.increment('someone')).totalHits).toBe(2);
		expect((await store.increment('another')).totalHits).toBe(1);
	});

	it('counts in memory while the Redis connection is not ready, without sending anything to it', async () => {
		const sendCommand = vi.fn(async () => 'sha');
		const store = startStore({ isReady: false, sendCommand } as unknown as RedisConnection['pub']);
		stores.push(store);
		sendCommand.mockClear();

		expect((await store.increment('someone')).totalHits).toBe(1);
		expect((await store.increment('someone')).totalHits).toBe(2);
		expect(sendCommand).not.toHaveBeenCalled();
	});
});

describe.skipIf(!testRedisUrl)('rate limit store with Redis', () => {
	const connections: RedisConnection[] = [];
	afterEach(async () => {
		await Promise.all(connections.splice(0).map((connection) => connection.close()));
	});

	// Each server instance has its own connection and its own store
	const startInstance = async () => {
		const connection = await connectToRedis(testRedisUrl!);
		connections.push(connection);
		const store = startStore(connection.pub);
		stores.push(store);
		return store;
	};

	it('counts together what the instances count', async () => {
		const [first, second] = [await startInstance(), await startInstance()];
		const key = randomUUID();

		expect((await first.increment(key)).totalHits).toBe(1);
		expect((await second.increment(key)).totalHits).toBe(2);
		expect((await first.increment(key)).totalHits).toBe(3);
	});

	it('keeps each key apart', async () => {
		const [first, second] = [await startInstance(), await startInstance()];

		expect((await first.increment(randomUUID())).totalHits).toBe(1);
		expect((await second.increment(randomUUID())).totalHits).toBe(1);
	});

	it('stops counting a key after resetKey', async () => {
		const [first, second] = [await startInstance(), await startInstance()];
		const key = randomUUID();
		await first.increment(key);
		await first.increment(key);

		await second.resetKey(key);

		expect((await first.increment(key)).totalHits).toBe(1);
	});
});
