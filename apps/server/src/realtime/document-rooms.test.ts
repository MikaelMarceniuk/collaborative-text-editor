import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { applyDocumentUpdate, loadDocumentState } from '../services/document-content.service.js';
import { createDocument, createUser } from '../test/helpers.js';
import { createDocumentRooms, InvalidUpdateError } from './document-rooms.js';

const textUpdate = (text: string) => {
	const ydoc = new Y.Doc();
	ydoc.getText('t').insert(0, text);
	return Y.encodeStateAsUpdate(ydoc);
};

const readText = (state: Uint8Array) => {
	const ydoc = new Y.Doc();
	Y.applyUpdate(ydoc, state);
	return ydoc.getText('t').toString();
};

const setup = async () => {
	const owner = await createUser();
	const document = await createDocument({ ownerId: owner.id });
	return { documentId: document._id };
};

describe('document rooms', () => {
	it('loads the saved state once for simultaneous joins', async () => {
		const { documentId } = await setup();
		await applyDocumentUpdate({ documentId, update: textUpdate('saved') });
		const rooms = createDocumentRooms();

		await Promise.all([rooms.join(documentId), rooms.join(documentId)]);

		const { update } = await rooms.sync(documentId, Y.encodeStateVector(new Y.Doc()));
		expect(readText(update)).toBe('saved');
		expect(rooms.size()).toBe(1);
	});

	it('syncs only what the client is missing', async () => {
		const { documentId } = await setup();
		const rooms = createDocumentRooms();
		await rooms.join(documentId);
		await rooms.applyUpdate(documentId, textUpdate('hello'));

		const client = new Y.Doc();
		const first = await rooms.sync(documentId, Y.encodeStateVector(client));
		Y.applyUpdate(client, first.update);
		expect(client.getText('t').toString()).toBe('hello');

		const second = await rooms.sync(documentId, Y.encodeStateVector(client));
		const empty = Y.encodeStateAsUpdate(new Y.Doc());
		expect(second.update).toEqual(empty);
		expect(second.stateVector).toEqual(first.stateVector);
	});

	it('rejects an invalid update and keeps the room usable', async () => {
		const { documentId } = await setup();
		const rooms = createDocumentRooms();
		await rooms.join(documentId);

		await expect(rooms.applyUpdate(documentId, new Uint8Array([255, 255, 255]))).rejects.toThrow(
			InvalidUpdateError,
		);

		await rooms.applyUpdate(documentId, textUpdate('ok'));
		const { update } = await rooms.sync(documentId, Y.encodeStateVector(new Y.Doc()));
		expect(readText(update)).toBe('ok');
	});

	it('drops the room when the last socket leaves', async () => {
		const { documentId } = await setup();
		const rooms = createDocumentRooms();
		await rooms.join(documentId);
		await rooms.join(documentId);

		await rooms.leave(documentId);
		expect(rooms.size()).toBe(1);

		await rooms.leave(documentId);
		expect(rooms.size()).toBe(0);
	});

	it('does not keep a failed load', async () => {
		const { documentId } = await setup();
		const rooms = createDocumentRooms();
		const load = vi
			.spyOn(await import('../services/document-content.service.js'), 'loadDocumentState')
			.mockRejectedValueOnce(new Error('mongo down'));

		await expect(rooms.join(documentId)).rejects.toThrow('mongo down');
		load.mockRestore();

		await rooms.join(documentId);
		expect(rooms.size()).toBe(1);
		expect(await loadDocumentState(documentId)).toBeDefined();
	});
});

describe('saving rooms', () => {
	const noop = async () => {};

	// Rooms with a fake save, so the debounce can be tested with fake timers without Mongo timing in the way
	const setupSaving = async (save = vi.fn<NonNullable<DocumentRoomsSave>>(noop)) => {
		const { documentId } = await setup();
		const rooms = createDocumentRooms({ save });
		await rooms.join(documentId);
		return { documentId, rooms, save };
	};
	type DocumentRoomsSave = NonNullable<Parameters<typeof createDocumentRooms>[0]>['save'];

	const withFakeTimers = async (run: () => Promise<void>) => {
		vi.useFakeTimers();
		try {
			await run();
		} finally {
			vi.useRealTimers();
		}
	};

	it('saves 2s after the last update, merging everything pending', async () => {
		const { documentId, rooms, save } = await setupSaving();

		await withFakeTimers(async () => {
			await rooms.applyUpdate(documentId, textUpdate('a'));
			await vi.advanceTimersByTimeAsync(1500);
			await rooms.applyUpdate(documentId, textUpdate('b'));
			await vi.advanceTimersByTimeAsync(1500);
			expect(save).not.toHaveBeenCalled();

			await vi.advanceTimersByTimeAsync(600);
			expect(save).toHaveBeenCalledOnce();
			const saved = readText(save.mock.calls[0]![0].update);
			expect(saved).toContain('a');
			expect(saved).toContain('b');
		});
	});

	it('saves at most 10s after the first update while edits keep coming', async () => {
		const { documentId, rooms, save } = await setupSaving();

		await withFakeTimers(async () => {
			for (let i = 0; i < 6; i++) {
				await rooms.applyUpdate(documentId, textUpdate(String(i)));
				await vi.advanceTimersByTimeAsync(1900);
			}
			expect(save).toHaveBeenCalledOnce();
		});
	});

	it('saves when the last socket leaves, and drops the room', async () => {
		const { documentId, rooms, save } = await setupSaving();
		await rooms.applyUpdate(documentId, textUpdate('bye'));

		await rooms.leave(documentId);

		expect(save).toHaveBeenCalledOnce();
		expect(rooms.size()).toBe(0);
	});

	it('keeps the updates and retries after a failed save', async () => {
		const save = vi
			.fn<NonNullable<DocumentRoomsSave>>(noop)
			.mockRejectedValueOnce(new Error('mongo down'));
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const { documentId, rooms } = await setupSaving(save);

		await withFakeTimers(async () => {
			await rooms.applyUpdate(documentId, textUpdate('keep'));
			await vi.advanceTimersByTimeAsync(2100);
			expect(save).toHaveBeenCalledTimes(1);

			// Later edits wait for the retry instead of saving on their own
			await rooms.applyUpdate(documentId, textUpdate('more'));
			await vi.advanceTimersByTimeAsync(500);
			expect(save).toHaveBeenCalledTimes(1);

			// The retry comes 1s after the failure
			await vi.advanceTimersByTimeAsync(600);
			expect(save).toHaveBeenCalledTimes(2);
			const retried = readText(save.mock.calls[1]![0].update);
			expect(retried).toContain('keep');
			expect(retried).toContain('more');
		});
	});

	it('keeps an unsaved room alive after the last socket leaves, until the save works', async () => {
		const save = vi
			.fn<NonNullable<DocumentRoomsSave>>(noop)
			.mockRejectedValueOnce(new Error('mongo down'));
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const { documentId, rooms } = await setupSaving(save);

		await withFakeTimers(async () => {
			await rooms.applyUpdate(documentId, textUpdate('precious'));
			await rooms.leave(documentId);
			expect(rooms.size()).toBe(1);

			await vi.advanceTimersByTimeAsync(1100);
			expect(save).toHaveBeenCalledTimes(2);
			expect(rooms.size()).toBe(0);
		});
	});

	it('does not save a dropped room', async () => {
		const { documentId, rooms, save } = await setupSaving();
		await rooms.applyUpdate(documentId, textUpdate('deleted'));

		await rooms.drop(documentId);
		await rooms.leave(documentId);

		expect(save).not.toHaveBeenCalled();
		expect(rooms.size()).toBe(0);
	});

	it('saves every room on flushAll', async () => {
		const { documentId, rooms, save } = await setupSaving();
		await rooms.applyUpdate(documentId, textUpdate('shutdown'));

		await rooms.flushAll();

		expect(save).toHaveBeenCalledOnce();
	});
});

describe('persistence', () => {
	it('stores what the room saves in Mongo, merged with the existing state', async () => {
		const { documentId } = await setup();
		await applyDocumentUpdate({ documentId, update: textUpdate('before') });
		const rooms = createDocumentRooms();
		await rooms.join(documentId);

		const extra = new Y.Doc();
		extra.getText('other').insert(0, 'after');
		await rooms.applyUpdate(documentId, Y.encodeStateAsUpdate(extra));
		await rooms.leave(documentId);

		const stored = new Y.Doc();
		Y.applyUpdate(stored, await loadDocumentState(documentId));
		expect(stored.getText('t').toString()).toBe('before');
		expect(stored.getText('other').toString()).toBe('after');
	});
});
