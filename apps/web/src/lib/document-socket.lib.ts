import { io } from 'socket.io-client';
import {
	applyAwarenessUpdate,
	Awareness,
	encodeAwarenessUpdate,
	removeAwarenessStates,
} from 'y-protocols/awareness';
import * as Y from 'yjs';

import type { PresenceUser } from './presence.lib';

// Updates that came from the server (or from the initial sync) carry this origin, so they are not sent back
export const REMOTE_ORIGIN = Symbol('remote');

export type SyncStatus = 'connecting' | 'ready' | 'not-found' | 'error';
export type SaveStatus = 'saved' | 'saving' | 'offline';

export interface DocumentSyncState {
	/** Until the first sync, whether the document could be loaded. */
	status: SyncStatus;
	saveStatus: SaveStatus;
}

interface DocumentSocketOptions {
	documentId: string;
	ydoc: Y.Doc;
	user: PresenceUser;
	onStateChange: (state: DocumentSyncState) => void;
	// The server says the user's access changed (role, removal), or the role it reports is not the one seen before
	onAccessChanged?: () => void;
}

type SyncResponse =
	| {
			ok: true;
			role: 'owner' | 'editor' | 'viewer';
			update: ArrayBuffer | Uint8Array;
			stateVector: ArrayBuffer | Uint8Array;
	  }
	| { ok: false; error: string };
type UpdateResponse = { ok: true } | { ok: false; error: 'forbidden' | 'invalid' };

const ACK_TIMEOUT_MS = 10_000;
// A cursor moves on every key and click, and only the latest position matters
const PRESENCE_THROTTLE_MS = 50;

interface PresenceMessage {
	clientId: number;
	update: ArrayBuffer | Uint8Array;
}

// Binary data arrives as an ArrayBuffer in the browser (and as a Buffer, which is already a Uint8Array, in Node)
const toBytes = (data: ArrayBuffer | Uint8Array) =>
	data instanceof Uint8Array ? data : new Uint8Array(data);

/**
 * Keeps a Y.Doc in sync with the server over a socket (protocol in docs/realtime.md).
 * - On every connection (the first and each reconnection) it runs the sync: sends its state vector, applies what the
 *   server is missing from it and sends back what the server is missing. That covers edits made while offline,
 *   so there is no queue of updates to retry.
 * - Afterwards, each local update is sent as it happens and each remote one is applied.
 * - What the user can do (edit or not) comes from the role the server answers on each sync, never from the client.
 * - The cursors and names of the other people travel in an Awareness, apart from the document (docs/presence.md).
 *   Presence is not content: viewers share theirs too, and nothing is saved.
 */
export const createDocumentSocket = ({
	documentId,
	ydoc,
	user,
	onStateChange,
	onAccessChanged,
}: DocumentSocketOptions) => {
	const awareness = new Awareness(ydoc);
	awareness.setLocalStateField('user', user);

	const socket = io(window.location.origin, {
		path: '/api/socket.io',
		transports: ['websocket'],
		withCredentials: true,
		auth: { documentId },
		// Connected below, one task later (see startTimer)
		autoConnect: false,
	});

	// React StrictMode mounts, unmounts and mounts again in the same task in development. Connecting a task later
	// means the first, discarded mount never opens a connection, which the dev proxy would log as EPIPE
	const startTimer = setTimeout(() => socket.connect(), 0);

	let status: SyncStatus = 'connecting';
	let online = false;
	// True from the moment the sync diff is computed until the connection drops. Local updates are sent only then:
	// before, they are part of the diff, and while offline the next sync carries them
	let synced = false;
	let canEdit = false;
	let knownRole: string | undefined;
	// The server already announced a change of access, so a different role on the next sync is not news
	let accessChangeAnnounced = false;
	// Local updates the server has not acknowledged yet
	const unacked = new Set<symbol>();

	const computeSaveStatus = (): SaveStatus =>
		!online ? 'offline' : unacked.size > 0 ? 'saving' : 'saved';

	let lastNotified = '';
	const notify = () => {
		const state: DocumentSyncState = { status, saveStatus: computeSaveStatus() };
		const key = `${state.status}:${state.saveStatus}`;
		if (key === lastNotified) return;
		lastNotified = key;
		onStateChange(state);
	};

	const sendUpdate = (update: Uint8Array, token: symbol) => {
		socket
			.timeout(ACK_TIMEOUT_MS)
			.emit('doc:update', update, (error: Error | null, response?: UpdateResponse) => {
				// On timeout the token stays: the next sync sends the update again, which is harmless
				if (error || !response) return;

				unacked.delete(token);
				if (!response.ok) {
					if (response.error === 'forbidden') onAccessChanged?.();
					else console.error('The server rejected a document update:', response.error);
				}
				notify();
			});
	};

	const handleLocalUpdate = (update: Uint8Array, origin: unknown) => {
		if (origin === REMOTE_ORIGIN || !canEdit) return;

		const token = Symbol('update');
		unacked.add(token);
		if (synced) sendUpdate(update, token);
		notify();
	};

	// Cursor moves are volatile: a position that could not be sent right away is already out of date. The first
	// presence and the answer to a query are not, because Socket.IO also drops a volatile message sent while the
	// connection is still writing the previous one (for example the sync diff, in the same tick)
	const sendPresence = (volatile = false) => {
		(volatile ? socket.volatile : socket).emit('awareness:update', {
			clientId: awareness.clientID,
			update: encodeAwarenessUpdate(awareness, [awareness.clientID]),
		} satisfies PresenceMessage);
	};

	// Leading and trailing: the first change goes out at once, and what happens during the wait goes out after it
	let presenceTimer: ReturnType<typeof setTimeout> | undefined;
	let presenceDirty = false;
	const sendPresenceThrottled = () => {
		if (presenceTimer) {
			presenceDirty = true;
			return;
		}

		sendPresence(true);
		presenceTimer = setTimeout(() => {
			presenceTimer = undefined;
			if (!presenceDirty) return;
			presenceDirty = false;
			sendPresenceThrottled();
		}, PRESENCE_THROTTLE_MS);
	};

	const handleLocalPresence = (
		{ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
		origin: unknown,
	) => {
		if (origin === REMOTE_ORIGIN) return;
		if (![...added, ...updated, ...removed].includes(awareness.clientID)) return;
		// Not connected, or still before the first sync: the next sync sends the presence again
		if (!synced) return;
		sendPresenceThrottled();
	};

	const removeRemotePresence = (clientIds: number[]) => {
		const others = clientIds.filter((clientId) => clientId !== awareness.clientID);
		if (others.length > 0) removeAwarenessStates(awareness, others, REMOTE_ORIGIN);
	};

	const runSync = () => {
		socket
			.timeout(ACK_TIMEOUT_MS)
			.emit(
				'doc:sync',
				Y.encodeStateVector(ydoc),
				(error: Error | null, response?: SyncResponse) => {
					if (error || !response?.ok) {
						if (response && !response.ok)
							console.error('Could not sync the document:', response.error);
						// Try again from scratch: a new connection runs the sync again
						if (status !== 'ready') {
							status = 'error';
							notify();
						}
						socket.disconnect().connect();
						return;
					}

					try {
						Y.applyUpdate(ydoc, toBytes(response.update), REMOTE_ORIGIN);

						// Covers the case where the announcement was lost (for example a connection that dropped on its own)
						if (knownRole !== undefined && knownRole !== response.role && !accessChangeAnnounced) {
							onAccessChanged?.();
						}
						accessChangeAnnounced = false;
						knownRole = response.role;
						canEdit = response.role === 'owner' || response.role === 'editor';

						if (canEdit) {
							// Everything up to here, including edits made offline, goes in this one update
							const covered = [...unacked];
							const diff = Y.encodeStateAsUpdate(ydoc, toBytes(response.stateVector));
							synced = true;
							socket
								.timeout(ACK_TIMEOUT_MS)
								.emit(
									'doc:update',
									diff,
									(sendError: Error | null, sendResponse?: UpdateResponse) => {
										if (sendError || !sendResponse?.ok) return;
										for (const token of covered) unacked.delete(token);
										notify();
									},
								);
						} else {
							synced = true;
							unacked.clear();
						}

						status = 'ready';
						online = true;
						notify();

						// Introduces itself and asks who is here: the others answer with their own state
						sendPresence();
						socket.emit('awareness:query');
					} catch (syncError) {
						// Without this, a bad response would leave the page on "Loading document…" forever
						console.error('Could not apply the synced document:', syncError);
						if (status !== 'ready') status = 'error';
						notify();
						socket.disconnect();
					}
				},
			);
	};

	socket.on('connect', runSync);

	socket.on('disconnect', (reason) => {
		synced = false;
		online = false;
		// Nobody can announce that the others left while this connection is down. The ones still there
		// show up again after the next sync
		removeRemotePresence([...awareness.getStates().keys()]);
		notify();

		// The server disconnects on purpose when access changes: the socket does not reconnect by itself then,
		// and the handshake will say whether the user is still allowed in
		if (reason === 'io server disconnect') socket.connect();
	});

	socket.on('connect_error', (error) => {
		online = false;

		if (error.message === 'not_found') {
			status = 'not-found';
			socket.disconnect();
		} else if (error.message === 'unauthorized') {
			status = 'error';
			socket.disconnect();
		} else if (status !== 'ready') {
			// Socket.IO keeps retrying; this only lets the page show that loading is failing
			status = 'error';
		}

		notify();
	});

	socket.on('doc:update', (update: ArrayBuffer | Uint8Array) => {
		Y.applyUpdate(ydoc, toBytes(update), REMOTE_ORIGIN);
	});

	socket.on('awareness:update', (message: PresenceMessage) => {
		applyAwarenessUpdate(awareness, toBytes(message.update), REMOTE_ORIGIN);
	});

	socket.on('awareness:query', () => sendPresence());

	socket.on('awareness:left', (clientId: number) => removeRemotePresence([clientId]));

	socket.on('doc:access-changed', () => {
		accessChangeAnnounced = true;
		onAccessChanged?.();
	});

	ydoc.on('update', handleLocalUpdate);
	awareness.on('update', handleLocalPresence);
	notify();

	return {
		awareness,
		hasUnsyncedChanges: () => unacked.size > 0,
		/** For the "Try again" of the error screen: reconnects right away instead of waiting for the next attempt. */
		retry: () => {
			status = 'connecting';
			notify();
			socket.connect();
		},
		destroy: () => {
			clearTimeout(startTimer);
			clearTimeout(presenceTimer);
			ydoc.off('update', handleLocalUpdate);
			awareness.off('update', handleLocalPresence);
			// Stops the Awareness timers. The server tells the others that this client left when the socket closes
			awareness.destroy();
			socket.disconnect();
		},
	};
};
