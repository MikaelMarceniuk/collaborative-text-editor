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
