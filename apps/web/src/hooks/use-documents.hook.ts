import { queryOptions, useQuery } from '@tanstack/react-query';

import { ApiError, apiFetch, apiFetchBinary } from '@/lib/api.lib';
import { waitForSavesInFlight } from '@/lib/document-sync.lib';

import { useAuthenticatedSession } from './use-session.hook';

export type DocumentRole = 'owner' | 'editor' | 'viewer';

export interface DocumentMember {
	userId: string;
	role: DocumentRole;
}

export interface DocumentSummary {
	_id: string;
	title: string;
	ownerId: string;
	members: DocumentMember[];
	createdAt: string;
	updatedAt: string;
}

export const documentsQueryKeys = {
	all: ['documents'] as const,
	list: (userId: string) => ['documents', userId] as const,
	detail: (userId: string, documentId: string) => ['documents', userId, documentId] as const,
	content: (userId: string, documentId: string) =>
		['documents', userId, documentId, 'content'] as const,
};

export const DOCUMENT_TITLE_MAX_LENGTH = 200;

export const canEditDocument = (role: DocumentRole | undefined) =>
	role === 'owner' || role === 'editor';

const fetchDocuments = async ({ signal }: { signal: AbortSignal }) => {
	const { documents } = await apiFetch<{ documents: DocumentSummary[] }>('/documents', { signal });

	return documents;
};

export const documentsQueryOptions = (userId: string) =>
	queryOptions({ queryKey: documentsQueryKeys.list(userId), queryFn: fetchDocuments });

export const useDocuments = () => {
	const { user } = useAuthenticatedSession();
	const { data, isPending, isError, isFetching, refetch } = useQuery(
		documentsQueryOptions(user.id),
	);

	return {
		documents: data ?? [],
		isDocumentsPending: isPending || (isError && isFetching),
		isDocumentsError: isError && !isFetching,
		refetchDocuments: refetch,
	};
};

const fetchDocument = async (documentId: string, signal: AbortSignal) => {
	const { document } = await apiFetch<{ document: DocumentSummary }>(`/documents/${documentId}`, {
		signal,
	});

	return document;
};

const isNotFoundError = (error: Error | null) => error instanceof ApiError && error.status === 404;

export const documentQueryOptions = (userId: string, documentId: string) =>
	queryOptions({
		queryKey: documentsQueryKeys.detail(userId, documentId),
		queryFn: ({ signal }) => fetchDocument(documentId, signal),
		retry: (failureCount, error) => !isNotFoundError(error) && failureCount < 3,
	});

export const useDocument = (documentId: string) => {
	const { user } = useAuthenticatedSession();
	const { data, error, isPending, isError, isFetching, refetch } = useQuery(
		documentQueryOptions(user.id, documentId),
	);

	return {
		document: data,
		isDocumentPending: isPending || (isError && isFetching),
		isDocumentError: isError && !isFetching,
		isDocumentNotFound: isNotFoundError(error),
		refetchDocument: refetch,
	};
};

const fetchDocumentContent = async (documentId: string, signal: AbortSignal) => {
	await waitForSavesInFlight(documentId);

	return apiFetchBinary(`/documents/${documentId}/content`, { signal });
};

export const documentContentQueryOptions = (userId: string, documentId: string) =>
	queryOptions({
		queryKey: documentsQueryKeys.content(userId, documentId),
		queryFn: ({ signal }) => fetchDocumentContent(documentId, signal),
		retry: (failureCount, error) => !isNotFoundError(error) && failureCount < 3,
		staleTime: Infinity,
		gcTime: 0,
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
	});

export const useDocumentContent = (documentId: string) => {
	const { user } = useAuthenticatedSession();
	const { data, error, isPending, isError, isFetching, refetch } = useQuery(
		documentContentQueryOptions(user.id, documentId),
	);

	return {
		content: data,
		isContentPending: isPending || (isError && isFetching),
		isContentError: isError && !isFetching,
		isContentNotFound: isNotFoundError(error),
		refetchContent: refetch,
	};
};
