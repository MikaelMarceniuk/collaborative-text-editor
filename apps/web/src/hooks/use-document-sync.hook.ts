import { useEffect, useState } from 'react';
import * as Y from 'yjs';

import { createDocumentSync, REMOTE_ORIGIN, type SaveStatus } from '@/lib/document-sync.lib';

export const useDocumentSync = (documentId: string, initialContent: Uint8Array) => {
	const [ydoc] = useState(() => {
		const doc = new Y.Doc();
		Y.applyUpdate(doc, initialContent, REMOTE_ORIGIN);
		return doc;
	});
	const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved');

	useEffect(() => {
		const sync = createDocumentSync({ documentId, ydoc, onSaveStatusChange: setSaveStatus });

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
	}, [documentId, ydoc]);

	return { ydoc, saveStatus };
};
