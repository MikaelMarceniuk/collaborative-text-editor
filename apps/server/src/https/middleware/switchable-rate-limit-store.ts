import {
	type ClientRateLimitInfo,
	type IncrementResponse,
	MemoryStore,
	type Options,
	type Store,
} from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';

import type { RedisConnection } from '../../config/redis.js';

/**
 * The hit counters of a rate limit, in Redis when the server has one and in memory otherwise.
 *
 * The routes (and so the limiters) are created when the app is imported, before the server has connected to Redis,
 * so the store cannot be chosen when the limiter is created. It starts in memory, switches to Redis when
 * useRedis() is called, and falls back to memory again whenever the Redis connection is not ready: a rate limit
 * that stops counting precisely for a while is better than invites that stop working.
 */
export class SwitchableRateLimitStore implements Store {
	// Counted in Redis, so what one instance counts the others see
	localKeys = false;

	private readonly memory = new MemoryStore();
	private redisStore?: RedisStore;
	private redis?: RedisConnection['pub'];
	private options?: Options;

	// The text put before every key in Redis
	readonly prefix: string;

	constructor(prefix: string) {
		this.prefix = prefix;
	}

	/** Moves the counters to Redis. Meant to be called once, by the server, after connecting. */
	useRedis(redis: RedisConnection['pub']) {
		this.redis = redis;
		this.redisStore = new RedisStore({
			prefix: this.prefix,
			sendCommand: (...args) => redis.sendCommand(args) as Promise<never>,
		});
		if (this.options) void this.redisStore.init(this.options);
	}

	private get current(): Store {
		return this.redis?.isReady && this.redisStore ? this.redisStore : this.memory;
	}

	init(options: Options) {
		this.options = options;
		this.memory.init(options);
		if (this.redisStore) void this.redisStore.init(options);
	}

	get(key: string): Promise<ClientRateLimitInfo | undefined> | ClientRateLimitInfo | undefined {
		return this.current.get?.(key);
	}

	increment(key: string): Promise<IncrementResponse> | IncrementResponse {
		return this.current.increment(key);
	}

	decrement(key: string) {
		return this.current.decrement(key);
	}

	resetKey(key: string) {
		return this.current.resetKey(key);
	}

	shutdown() {
		this.memory.shutdown();
	}
}
