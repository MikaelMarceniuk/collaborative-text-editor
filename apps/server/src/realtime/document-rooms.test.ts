import type { ObjectId } from 'mongodb';
import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import {
	applyDocumentUpdate,
	CONTENT_FIELD,
	loadDocumentState,
} from '../services/document-content.service.js';
import { createDocument, createUser } from '../test/helpers.js';
import { createDocumentRooms, InvalidUpdateError } from './document-rooms.js';
import type { RoomPeers } from './room-peers.js';

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

describe('versions', () => {
	// An update with a paragraph in the field the editor writes to, so the room has content to keep
	const contentUpdate = (text: string) => {
		const ydoc = new Y.Doc();
		const paragraph = new Y.XmlElement('paragraph');
		paragraph.insert(0, [new Y.XmlText(text)]);
		ydoc.getXmlFragment(CONTENT_FIELD).insert(0, [paragraph]);
		return Y.encodeStateAsUpdate(ydoc);
	};

	type AutoVersion = NonNullable<Parameters<typeof createDocumentRooms>[0]>['autoVersion'];

	const setupVersions = async (autoVersion = vi.fn<NonNullable<AutoVersion>>(async () => null)) => {
		const { documentId } = await setup();
		const save = vi.fn(async () => {});
		const rooms = createDocumentRooms({ save, autoVersion });
		await rooms.join(documentId);
		return { documentId, rooms, save, autoVersion };
	};

	it('asks for a version after a save, with the state the room holds', async () => {
		const { documentId, rooms, autoVersion } = await setupVersions();
		await rooms.applyUpdate(documentId, contentUpdate('hello'));

		await rooms.leave(documentId);

		const [first] = autoVersion.mock.calls;
		expect(first![0].when).toBe('due');
		const ydoc = new Y.Doc();
		Y.applyUpdate(ydoc, first![0].getState());
		expect(ydoc.getXmlFragment(CONTENT_FIELD).toString()).toContain('hello');
	});

	it('asks again, for what changed, when the last socket leaves', async () => {
		const { documentId, rooms, autoVersion } = await setupVersions();
		await rooms.applyUpdate(documentId, contentUpdate('hello'));

		await rooms.leave(documentId);

		expect(autoVersion.mock.calls.map(([{ when }]) => when)).toEqual(['due', 'changed']);
	});

	it('does not ask while someone is still in the room', async () => {
		const { documentId, rooms, autoVersion } = await setupVersions();
		await rooms.join(documentId);
		await rooms.applyUpdate(documentId, contentUpdate('hello'));

		await rooms.leave(documentId);

		expect(autoVersion.mock.calls.map(([{ when }]) => when)).not.toContain('changed');
	});

	it('does not version a room with no content', async () => {
		const { documentId, rooms, autoVersion } = await setupVersions();
		await rooms.applyUpdate(documentId, textUpdate('not the editor field'));

		await rooms.leave(documentId);

		expect(autoVersion).not.toHaveBeenCalled();
	});

	it('saves and leaves normally when the version cannot be made', async () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		const autoVersion = vi.fn<NonNullable<AutoVersion>>(async () => {
			throw new Error('mongo is down');
		});
		const { documentId, rooms, save } = await setupVersions(autoVersion);
		await rooms.applyUpdate(documentId, contentUpdate('hello'));

		await rooms.leave(documentId);

		expect(save).toHaveBeenCalledOnce();
		expect(rooms.size()).toBe(0);
		error.mockRestore();
	});

	it('gives the current state, with what is not saved yet, and keeps the room of those inside', async () => {
		const { documentId, rooms } = await setupVersions();
		await rooms.applyUpdate(documentId, contentUpdate('unsaved'));

		const state = await rooms.currentState(documentId);

		const ydoc = new Y.Doc();
		Y.applyUpdate(ydoc, state);
		expect(ydoc.getXmlFragment(CONTENT_FIELD).toString()).toContain('unsaved');
		expect(rooms.size()).toBe(1);
	});

	it('opens a room to give the state of a document nobody has open, and closes it', async () => {
		const { documentId } = await setup();
		await applyDocumentUpdate({ documentId, update: contentUpdate('saved') });
		const rooms = createDocumentRooms();

		const state = await rooms.currentState(documentId);

		const ydoc = new Y.Doc();
		Y.applyUpdate(ydoc, state);
		expect(ydoc.getXmlFragment(CONTENT_FIELD).toString()).toContain('saved');
		expect(rooms.size()).toBe(0);
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

describe('rooms across instances', () => {
	const fakePeers = (overrides: Partial<RoomPeers> = {}): RoomPeers => ({
		publishUpdate: vi.fn(),
		requestState: vi.fn(async () => []),
		dropEverywhere: vi.fn(async () => {}),
		announceReturn: vi.fn(),
		listen: vi.fn(),
		...overrides,
	});

	const stateOf = async (rooms: ReturnType<typeof createDocumentRooms>, documentId: ObjectId) =>
		readText((await rooms.sync(documentId, Y.encodeStateVector(new Y.Doc()))).update);

	it('tells the other instances about each update it applies', async () => {
		const { documentId } = await setup();
		const peers = fakePeers();
		const rooms = createDocumentRooms({ peers });
		await rooms.join(documentId);
		const update = textUpdate('hello');

		await rooms.applyUpdate(documentId, update);

		expect(peers.publishUpdate).toHaveBeenCalledExactlyOnceWith(documentId, update);
	});

	it('does not tell the others about an update it rejected', async () => {
		const { documentId } = await setup();
		const peers = fakePeers();
		const rooms = createDocumentRooms({ peers });
		await rooms.join(documentId);

		await expect(rooms.applyUpdate(documentId, new Uint8Array([255, 255, 255]))).rejects.toThrow();

		expect(peers.publishUpdate).not.toHaveBeenCalled();
	});

	it('starts from what the other instances hold, on top of what is saved', async () => {
		const { documentId } = await setup();
		await applyDocumentUpdate({ documentId, update: textUpdate('saved') });
		const unsaved = new Y.Doc();
		unsaved.getText('t').insert(0, 'unsaved elsewhere');
		const peers = fakePeers({
			requestState: vi.fn(async () => [Y.encodeStateAsUpdate(unsaved)]),
		});
		const rooms = createDocumentRooms({ peers });

		await rooms.join(documentId);

		expect(await stateOf(rooms, documentId)).toContain('unsaved elsewhere');
		expect(await stateOf(rooms, documentId)).toContain('saved');
	});

	it('fails the join, and keeps no room, when the other instances do not answer', async () => {
		const { documentId } = await setup();
		const requestState = vi
			.fn<RoomPeers['requestState']>()
			.mockRejectedValueOnce(new Error('no answer'))
			.mockResolvedValue([]);
		const rooms = createDocumentRooms({ peers: fakePeers({ requestState }) });

		await expect(rooms.join(documentId)).rejects.toThrow('no answer');
		expect(rooms.size()).toBe(0);

		// The next join asks again
		await rooms.join(documentId);
		expect(rooms.size()).toBe(1);
	});

	it('applies the update of another instance, without saving it', async () => {
		const { documentId } = await setup();
		const save = vi.fn(async () => {});
		const rooms = createDocumentRooms({ peers: fakePeers(), save });
		await rooms.join(documentId);

		await rooms.applyRemoteUpdate(documentId, textUpdate('from elsewhere'));
		await rooms.flushAll();

		expect(await stateOf(rooms, documentId)).toBe('from elsewhere');
		expect(save).not.toHaveBeenCalled();
	});

	it('ignores the update of another instance when there is no room', async () => {
		const { documentId } = await setup();
		const rooms = createDocumentRooms({ peers: fakePeers() });

		await rooms.applyRemoteUpdate(documentId, textUpdate('nobody here'));

		expect(rooms.size()).toBe(0);
	});

	it('applies an update of another instance that arrives while the room is loading', async () => {
		const { documentId } = await setup();
		let answer!: (states: Uint8Array[]) => void;
		const requestState = vi.fn(
			() =>
				new Promise<Uint8Array[]>((resolve) => {
					answer = resolve;
				}),
		);
		const rooms = createDocumentRooms({ peers: fakePeers({ requestState }) });

		const joining = rooms.join(documentId);
		const applying = rooms.applyRemoteUpdate(documentId, textUpdate('during the load'));
		answer([]);
		await Promise.all([joining, applying]);

		expect(await stateOf(rooms, documentId)).toBe('during the load');
	});

	it('does not make another instance wait for a room that is still loading', async () => {
		const { documentId } = await setup();
		const requestState = vi.fn(() => new Promise<Uint8Array[]>(() => {}));
		const rooms = createDocumentRooms({ peers: fakePeers({ requestState }) });

		void rooms.join(documentId).catch(() => undefined);

		// The loading room is waiting for the others, so it cannot answer them with anything
		expect(await rooms.stateOf(documentId)).toBeNull();
	});

	it('shares its state with another instance only when it has the room', async () => {
		const { documentId } = await setup();
		const rooms = createDocumentRooms({ peers: fakePeers() });
		expect(await rooms.stateOf(documentId)).toBeNull();

		await rooms.join(documentId);
		await rooms.applyUpdate(documentId, textUpdate('mine'));

		expect(readText((await rooms.stateOf(documentId))!)).toBe('mine');
	});
});

describe('catching up rooms after Redis was gone', () => {
	const peersAnswering = (requestState: RoomPeers['requestState']): RoomPeers => ({
		publishUpdate: vi.fn(),
		requestState,
		dropEverywhere: vi.fn(async () => {}),
		announceReturn: vi.fn(),
		listen: vi.fn(),
	});

	it('applies what the other instances have, and says which documents learned something', async () => {
		const { documentId } = await setup();
		const missed = new Y.Doc();
		missed.getText('t').insert(0, 'sent while Redis was gone');
		const answers: Uint8Array[][] = [[], [Y.encodeStateAsUpdate(missed)]];
		const rooms = createDocumentRooms({ peers: peersAnswering(async () => answers.shift()!) });
		await rooms.join(documentId);

		expect(await rooms.resync()).toEqual([documentId]);

		const { update } = await rooms.sync(documentId, Y.encodeStateVector(new Y.Doc()));
		expect(readText(update)).toBe('sent while Redis was gone');
	});

	it('says nothing about a room that already had everything', async () => {
		const { documentId } = await setup();
		const known = textUpdate('known');
		// The other instances hold the same state the room started from
		const rooms = createDocumentRooms({ peers: peersAnswering(async () => [known]) });
		await rooms.join(documentId);

		expect(await rooms.resync()).toEqual([]);
	});

	it('notices a deletion made elsewhere, which does not change the state vector', async () => {
		const { documentId } = await setup();
		const first = new Y.Doc();
		first.getText('t').insert(0, 'hello');
		const written = Y.encodeStateAsUpdate(first);
		const answers: Uint8Array[][] = [[], []];
		const rooms = createDocumentRooms({ peers: peersAnswering(async () => answers.shift()!) });
		await rooms.join(documentId);
		await rooms.applyUpdate(documentId, written);

		// Another instance deleted the text
		const other = new Y.Doc();
		Y.applyUpdate(other, written);
		other.getText('t').delete(0, 5);
		answers.length = 0;
		answers.push([Y.encodeStateAsUpdate(other)]);

		expect(await rooms.resync()).toEqual([documentId]);
		const { update } = await rooms.sync(documentId, Y.encodeStateVector(new Y.Doc()));
		expect(readText(update)).toBe('');
	});

	it('skips a room whose request fails and still catches up the others', async () => {
		const [first, second] = [await setup(), await setup()];
		const missed = new Y.Doc();
		missed.getText('t').insert(0, 'missed');
		let afterOutage = false;
		const requestState = vi.fn<RoomPeers['requestState']>(async (documentId) => {
			if (!afterOutage) return [];
			if (documentId.equals(first.documentId)) throw new Error('no answer');
			return [Y.encodeStateAsUpdate(missed)];
		});
		const rooms = createDocumentRooms({ peers: peersAnswering(requestState) });
		await rooms.join(first.documentId);
		await rooms.join(second.documentId);
		afterOutage = true;
		const errors = vi.spyOn(console, 'error').mockImplementation(() => {});

		expect(await rooms.resync()).toEqual([second.documentId]);

		errors.mockRestore();
	});

	it('does not ask about a room that is still loading', async () => {
		const { documentId } = await setup();
		const requestState = vi.fn(() => new Promise<Uint8Array[]>(() => {}));
		const rooms = createDocumentRooms({ peers: peersAnswering(requestState) });
		void rooms.join(documentId).catch(() => undefined);
		requestState.mockClear();

		expect(await rooms.resync()).toEqual([]);
		expect(requestState).not.toHaveBeenCalled();
	});
});
