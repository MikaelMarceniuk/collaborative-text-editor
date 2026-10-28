import * as Y from 'yjs';

import { ApiError, apiFetchBinary } from './api.lib';

export type SaveStatus = 'saved' | 'saving' | 'error';

const SAVE_DEBOUNCE_MS = 1000;
const SAVE_MAX_WAIT_MS = 5000;
const RETRY_BASE_DELAY_MS = 1000;
const RETRY_MAX_DELAY_MS = 30_000;
const KEEPALIVE_MAX_BYTES = 60 * 1024;

export const REMOTE_ORIGIN = Symbol('remote');

const savesInFlight = new Map<string, Set<Promise<unknown>>>();

export const waitForSavesInFlight = async (documentId: string) => {
	await Promise.allSettled(savesInFlight.get(documentId) ?? []);
};

const trackSave = (documentId: string, save: Promise<unknown>) => {
	const saves = savesInFlight.get(documentId) ?? new Set();
	savesInFlight.set(documentId, saves.add(save));

	const untrack = () => {
		saves.delete(save);
		if (saves.size === 0) savesInFlight.delete(documentId);
	};
	save.then(untrack, untrack);
};

const isRetryable = (error: unknown) =>
	!(error instanceof ApiError) ||
	error.status === 408 ||
	error.status === 429 ||
	error.status >= 500;

interface DocumentSyncOptions {
	documentId: string;
	ydoc: Y.Doc;
	onSaveStatusChange: (status: SaveStatus) => void;
}

export const createDocumentSync = ({
	documentId,
	ydoc,
	onSaveStatusChange,
}: DocumentSyncOptions) => {
	let pendingUpdates: Uint8Array[] = [];
	let savesInFlightCount = 0;
	let retryAttempt = 0;
	let hasFailed = false;
	let hasFailedPermanently = false;
	let debounceTimer: ReturnType<typeof setTimeout> | undefined;
	let maxWaitTimer: ReturnType<typeof setTimeout> | undefined;
	let retryTimer: ReturnType<typeof setTimeout> | undefined;

	let saveStatus: SaveStatus = 'saved';
	const updateSaveStatus = () => {
		const nextStatus: SaveStatus = hasFailed
			? 'error'
			: pendingUpdates.length > 0 || savesInFlightCount > 0
				? 'saving'
				: 'saved';

		if (nextStatus === saveStatus) return;
		saveStatus = nextStatus;
		onSaveStatusChange(nextStatus);
	};

	const clearTimers = () => {
		clearTimeout(debounceTimer);
		clearTimeout(maxWaitTimer);
		clearTimeout(retryTimer);
		debounceTimer = maxWaitTimer = retryTimer = undefined;
	};

	const scheduleRetry = () => {
		const delay = Math.min(RETRY_BASE_DELAY_MS * 2 ** retryAttempt, RETRY_MAX_DELAY_MS);
		retryAttempt++;
		retryTimer = setTimeout(flush, delay);
	};

	const flush = () => {
		clearTimers();
		if (pendingUpdates.length === 0 || hasFailedPermanently) return;

		const update = Y.mergeUpdates(pendingUpdates);
		pendingUpdates = [];
		savesInFlightCount++;
		updateSaveStatus();

		const save = apiFetchBinary(`/documents/${documentId}/updates`, {
			method: 'POST',
			body: update,
			keepalive: update.byteLength <= KEEPALIVE_MAX_BYTES,
		});
		trackSave(documentId, save);

		save
			.then(() => {
				retryAttempt = 0;
				hasFailed = false;
			})
			.catch((error: unknown) => {
				pendingUpdates.unshift(update);
				hasFailed = true;

				if (isRetryable(error)) {
					if (!retryTimer) scheduleRetry();
				} else {
					hasFailedPermanently = true;
					console.error('Could not save the document:', error);
				}
			})
			.finally(() => {
				savesInFlightCount--;
				updateSaveStatus();
			});
	};

	const scheduleSave = () => {
		clearTimeout(debounceTimer);
		debounceTimer = setTimeout(flush, SAVE_DEBOUNCE_MS);
		maxWaitTimer ??= setTimeout(flush, SAVE_MAX_WAIT_MS);
	};

	const handleUpdate = (update: Uint8Array, origin: unknown) => {
		if (origin === REMOTE_ORIGIN) return;

		pendingUpdates.push(update);
		updateSaveStatus();
		scheduleSave();
	};

	ydoc.on('update', handleUpdate);

	return {
		flush,
		hasUnsavedChanges: () => pendingUpdates.length > 0 || savesInFlightCount > 0,
		destroy: () => {
			ydoc.off('update', handleUpdate);
			flush();
		},
	};
};
