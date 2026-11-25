import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import type { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';

import { toast } from '@/components/ui/toast';
import { createDocumentSocket, type DocumentSyncState } from '@/lib/document-socket.lib';
import { getPresenceUser } from '@/lib/presence.lib';

import { documentsQueryKeys } from './use-documents.hook';
import { useAuthenticatedSession } from './use-session.hook';

/**
 * Opens the document's socket and keeps a Y.Doc in sync with the server. The document is ready for the editor
 * when `status` is "ready": the first sync has already put the content in `ydoc`.
 * It also exposes the `awareness` with the presence of the people in the document (cursors and names).
 * The page must give this hook a `key` (the document id), so a new document never inherits the previous Y.Doc.
 */
export const useDocumentSync = (documentId: string) => {
	const [ydoc] = useState(() => new Y.Doc());
	const [state, setState] = useState<DocumentSyncState>({
		status: 'connecting',
		saveStatus: 'saved',
	});
	// Created together with the socket, so it exists by the time the editor mounts (after the first sync)
	const [awareness, setAwareness] = useState<Awareness | null>(null);
	const syncRef = useRef<ReturnType<typeof createDocumentSocket>>(null);
	const { user } = useAuthenticatedSession();
	const queryClient = useQueryClient();

	useEffect(() => {
		const sync = createDocumentSocket({
			documentId,
			ydoc,
			user: getPresenceUser(user),
			onStateChange: setState,
			onAccessChanged: () => {
				toast.add({ type: 'info', title: 'Your access to this document changed' });
				// Reloads the role: someone who was removed gets "Document not found",
				// someone who became a viewer gets the view-only editor
				void queryClient.invalidateQueries({
					queryKey: documentsQueryKeys.detail(user.id, documentId),
					exact: true,
				});
			},
		});
		syncRef.current = sync;
		setAwareness(sync.awareness);

		const handleBeforeUnload = (event: BeforeUnloadEvent) => {
			if (sync.hasUnsyncedChanges()) event.preventDefault();
		};
		window.addEventListener('beforeunload', handleBeforeUnload);

		return () => {
			window.removeEventListener('beforeunload', handleBeforeUnload);
			syncRef.current = null;
			sync.destroy();
		};
	}, [documentId, ydoc, queryClient, user.id, user.name, user.isAnonymous]);

	return { ydoc, awareness, ...state, retry: () => syncRef.current?.retry() };
};
