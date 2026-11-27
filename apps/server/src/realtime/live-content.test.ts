import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { io as connect, type Socket } from 'socket.io-client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { collections } from '../config/mongodb.js';
import { CONTENT_FIELD, loadDocumentState } from '../services/document-content.service.js';
import { asUser, createDocument, createUser } from '../test/helpers.js';
import { liveContent } from './live-content.js';
import { createSocketServer, SOCKET_PATH } from './socket-server.js';

vi.mock('./socket-session.js', () => import('../test/mock-socket-session.js'));

let httpServer: HttpServer | undefined;
let socketServer: ReturnType<typeof createSocketServer> | undefined;
const clients: Socket[] = [];

afterEach(async () => {
	for (const client of clients.splice(0)) client.disconnect();
	await socketServer?.close();
	httpServer = socketServer = undefined;
});

const contentUpdate = (text: string) => {
	const ydoc = new Y.Doc();
	const paragraph = new Y.XmlElement('paragraph');
	paragraph.insert(0, [new Y.XmlText(text)]);
	ydoc.getXmlFragment(CONTENT_FIELD).insert(0, [paragraph]);
	return Y.encodeStateAsUpdate(ydoc);
};

const contentOf = (ydoc: Y.Doc) => ydoc.getXmlFragment(CONTENT_FIELD).toString();

const setup = async () => {
	const owner = await createUser();
	const editor = await createUser();
	const document = await createDocument({
		ownerId: owner.id,
		members: [{ userId: editor.id, role: 'editor' }],
	});

	httpServer = createServer();
	socketServer = createSocketServer(httpServer);
	await new Promise<void>((resolve) => httpServer!.listen(0, resolve));
	const url = `http://localhost:${(httpServer.address() as AddressInfo).port}`;

	// A client with its own Y.Doc, synced the way the web does
	const open = async (user: { id: import('mongodb').ObjectId }) => {
		const socket = connect(url, {
			path: SOCKET_PATH,
			transports: ['websocket'],
			reconnection: false,
			auth: { documentId: document._id.toHexString() },
			extraHeaders: asUser(user.id),
		});
		clients.push(socket);
		const ydoc = new Y.Doc();
		socket.on('doc:update', (update: Uint8Array) => Y.applyUpdate(ydoc, update));
		await new Promise<void>((resolve) => socket.once('connect', resolve));
		const sync = await socket.emitWithAck('doc:sync', Y.encodeStateVector(ydoc));
		Y.applyUpdate(ydoc, sync.update);
		return { socket, ydoc };
	};

	return { document, owner, editor, open };
};

describe('liveContent with the socket server', () => {
	it('gives the editors the restored content, the ones who did not ask included', async () => {
		const { document, owner, editor, open } = await setup();
		const [alice, bob] = await Promise.all([open(owner), open(editor)]);
		// The edit is in her own document too, as it is in the editor
		const edit = contentUpdate('current');
		Y.applyUpdate(alice.ydoc, edit);
		await alice.socket.emitWithAck('doc:update', edit);
		await vi.waitFor(() => expect(contentOf(bob.ydoc)).toContain('current'));

		await liveContent.restore(document._id, contentUpdate('restored'));

		await vi.waitFor(() => expect(contentOf(alice.ydoc)).toContain('restored'));
		await vi.waitFor(() => expect(contentOf(bob.ydoc)).toContain('restored'));
		expect(contentOf(bob.ydoc)).not.toContain('current');
	});

	it('gives the state an editor has not saved yet', async () => {
		const { document, owner, open } = await setup();
		const alice = await open(owner);
		await alice.socket.emitWithAck('doc:update', contentUpdate('not saved'));

		const state = await liveContent.currentState(document._id);

		const ydoc = new Y.Doc();
		Y.applyUpdate(ydoc, state);
		expect(contentOf(ydoc)).toContain('not saved');
		expect((await collections.documents.findOne({ _id: document._id }))?.ydocState).toBeUndefined();
	});

	it('saves the restored content when nobody is in the document', async () => {
		const { document } = await setup();

		await liveContent.restore(document._id, contentUpdate('restored'));

		const ydoc = new Y.Doc();
		Y.applyUpdate(ydoc, await loadDocumentState(document._id));
		expect(contentOf(ydoc)).toContain('restored');
	});
});
