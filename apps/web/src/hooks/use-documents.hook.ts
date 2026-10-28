import { queryOptions, useQuery } from '@tanstack/react-query';

import { apiFetch } from '@/lib/api.lib';

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
};

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
