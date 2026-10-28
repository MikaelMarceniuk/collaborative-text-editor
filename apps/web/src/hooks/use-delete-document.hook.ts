import { useMutation, useQueryClient } from '@tanstack/react-query';

import { toast } from '@/components/ui/toast';
import { apiFetch } from '@/lib/api.lib';

import { DOCUMENTS_QUERY_KEY, type DocumentSummary } from './use-documents.hook';

export const useDeleteDocument = () => {
	const queryClient = useQueryClient();

	const { mutate, isPending } = useMutation({
		mutationFn: (documentId: string) =>
			apiFetch<void>(`/documents/${documentId}`, { method: 'DELETE' }),
		onSuccess: (_, documentId) => {
			queryClient.setQueryData<DocumentSummary[]>(DOCUMENTS_QUERY_KEY, (documents) =>
				documents?.filter((document) => document._id !== documentId),
			);
			toast.add({ type: 'success', title: 'Document deleted' });
		},
		onError: () => {
			toast.add({
				type: 'error',
				title: 'Could not delete document',
				description: 'Something went wrong. Please try again.',
			});
		},
	});

	const handleDeleteDocument = (documentId: string, options?: { onSuccess?: () => void }) =>
		mutate(documentId, options);

	return {
		handleDeleteDocument,
		isDeleteDocumentPending: isPending,
	};
};
