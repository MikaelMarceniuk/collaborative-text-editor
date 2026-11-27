import { queryOptions, useQuery } from '@tanstack/react-query';

import { apiFetch } from '@/lib/api.lib';
import { base64ToBytes } from '@/lib/base64.lib';

import { documentsQueryKeys } from './use-documents.hook';
import { useAuthenticatedSession } from './use-session.hook';

export type DocumentVersionKind = 'auto' | 'manual' | 'before-restore';

// A version as the history lists it. The content comes apart, only for the one being previewed
export interface DocumentVersion {
	_id: string;
	documentId: string;
	kind: DocumentVersionKind;
	label?: string;
	// Bytes of the snapshot
	size: number;
	// Null on the versions the server makes by itself; the name is null when the account no longer exists
	createdBy: { userId: string; name: string | null } | null;
	createdAt: string;
}

const fetchVersions = async (documentId: string, signal: AbortSignal) => {
	const { versions } = await apiFetch<{ versions: DocumentVersion[] }>(
		`/documents/${documentId}/versions`,
		{ signal },
	);

	return versions;
};

export const documentVersionsQueryOptions = (userId: string, documentId: string) =>
	queryOptions({
		queryKey: documentsQueryKeys.versions(userId, documentId),
		queryFn: ({ signal }) => fetchVersions(documentId, signal),
	});

interface UseDocumentVersionsOptions {
	// The history is only fetched while the dialog is open
	enabled?: boolean;
}

export const useDocumentVersions = (
	documentId: string,
	{ enabled = true }: UseDocumentVersionsOptions = {},
) => {
	const { user } = useAuthenticatedSession();
	const { data, isPending, isError, isFetching, refetch } = useQuery({
		...documentVersionsQueryOptions(user.id, documentId),
		enabled,
	});

	return {
		versions: data ?? [],
		isVersionsPending: isPending || (isError && isFetching),
		isVersionsError: isError && !isFetching,
		refetchVersions: refetch,
	};
};

const fetchSnapshot = async (documentId: string, versionId: string, signal: AbortSignal) => {
	const { snapshot } = await apiFetch<{ snapshot: string }>(
		`/documents/${documentId}/versions/${versionId}`,
		{ signal },
	);

	return base64ToBytes(snapshot);
};

// The content of a version, as a Yjs update. A version never changes, so it is fetched once
export const useVersionSnapshot = (documentId: string, versionId: string | undefined) => {
	const { user } = useAuthenticatedSession();
	const { data, isPending, isError, isFetching, refetch } = useQuery({
		queryKey: documentsQueryKeys.version(user.id, documentId, versionId ?? ''),
		queryFn: ({ signal }) => fetchSnapshot(documentId, versionId!, signal),
		enabled: Boolean(versionId),
		staleTime: Infinity,
	});

	return {
		snapshot: data,
		isSnapshotPending: Boolean(versionId) && (isPending || (isError && isFetching)),
		isSnapshotError: isError && !isFetching,
		refetchSnapshot: refetch,
	};
};
