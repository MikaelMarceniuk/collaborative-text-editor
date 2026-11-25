import { describe, expect, it } from 'vitest';

import { connectToRedis } from './redis.js';

describe('connectToRedis', () => {
	it('gives up after the attempts when nothing is listening', async () => {
		// Port 1 is never open: the first connection must fail instead of retrying forever
		await expect(
			connectToRedis('redis://127.0.0.1:1', { maxAttempts: 2, retryDelayMs: 10 }),
		).rejects.toThrow();
	});
});
