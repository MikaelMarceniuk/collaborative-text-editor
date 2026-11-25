import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import * as Y from 'yjs';

import { toast } from '@/components/ui/toast';
import { createDocumentSync, REMOTE_ORIGIN, type SaveStatus } from '@/lib/document-sync.lib';

import { documentsQueryKeys } from './use-documents.hook';
import { useAuthenticatedSession } from './use-session.hook';

export const useDocumentSync = (
	documentId: string,
	initialContent: Uint8Array,
	{ canEdit }: { canEdit: boolean },
) => {
	const [ydoc] = useState(() => {
		const doc = new Y.Doc();
		Y.applyUpdate(doc, initialContent, REMOTE_ORIGIN);
		return doc;
	});
	const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved');
	const { user } = useAuthenticatedSession();
	const queryClient = useQueryClient();

	useEffect(() => {
		// Viewers never send anything: the server would answer 403 to every update
		if (!canEdit) return;

		const sync = createDocumentSync({
			documentId,
			ydoc,
			onSaveStatusChange: setSaveStatus,
			onAccessLost: () => {
				toast.add({
					type: 'error',
					title: 'Your access to this document changed',
					description: "Your latest changes couldn't be saved.",
				});
				// Reloads the role: someone who was removed gets "Document not found",
				// someone who became a viewer gets the view-only editor
				void queryClient.invalidateQueries({
					queryKey: documentsQueryKeys.detail(user.id, documentId),
					exact: true,
				});
			},
		});

		const handleVisibilityChange = () => {
			if (window.document.visibilityState === 'hidden') sync.flush();
		};

		const handleBeforeUnload = (event: BeforeUnloadEvent) => {
			if (sync.hasUnsavedChanges()) event.preventDefault();
		};

		window.document.addEventListener('visibilitychange', handleVisibilityChange);
		window.addEventListener('beforeunload', handleBeforeUnload);

		return () => {
			window.document.removeEventListener('visibilitychange', handleVisibilityChange);
			window.removeEventListener('beforeunload', handleBeforeUnload);
			sync.destroy();
		};
	}, [documentId, ydoc, canEdit, queryClient, user.id]);

	return { ydoc, saveStatus };
};
