import type { Server } from 'socket.io';
import { describe, expect, it, vi } from 'vitest';

import type { RedisConnection } from '../config/redis.js';
import { newUserId as newObjectId } from '../test/helpers.js';
import { createRoomPeers } from './room-peers.js';

// Redis is down: the pub client is not ready, and the instance must not wait for anyone
const disconnectedRedis = { pub: { isReady: false } } as unknown as RedisConnection;

describe('room peers while Redis is unreachable', () => {
	it('publishes nothing', () => {
		const io = { serverSideEmit: vi.fn() } as unknown as Server;

		createRoomPeers(io, disconnectedRedis).publishUpdate(newObjectId(), new Uint8Array([1]));

		expect(io.serverSideEmit).not.toHaveBeenCalled();
	});

	it('asks nobody and starts the room from what it has', async () => {
		const io = { serverSideEmitWithAck: vi.fn() } as unknown as Server;

		const states = await createRoomPeers(io, disconnectedRedis).requestState(newObjectId());

		expect(states).toEqual([]);
		expect(io.serverSideEmitWithAck).not.toHaveBeenCalled();
	});
});
