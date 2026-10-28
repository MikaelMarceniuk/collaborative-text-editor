import { useQuery } from '@tanstack/react-query';

import { apiFetch } from '@/lib/api.lib';

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

export const DOCUMENTS_QUERY_KEY = ['documents'];

export const useDocuments = () => {
	const { data, isPending, isError, isFetching, refetch } = useQuery({
		queryKey: DOCUMENTS_QUERY_KEY,
		queryFn: async ({ signal }) => {
			const { documents } = await apiFetch<{ documents: DocumentSummary[] }>('/documents', {
				signal,
			});

			return documents;
		},
	});

	return {
		documents: data ?? [],
		// A retry after an error keeps the "error" status, so treat it as pending to show the skeleton.
		isDocumentsPending: isPending || (isError && isFetching),
		isDocumentsError: isError && !isFetching,
		refetchDocuments: refetch,
	};
};
