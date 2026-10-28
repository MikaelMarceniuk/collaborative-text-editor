import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';

import { toast } from '@/components/ui/toast';
import { apiFetch } from '@/lib/api.lib';

import { documentsQueryKeys, type DocumentSummary } from './use-documents.hook';

export const useCreateDocument = () => {
	const navigate = useNavigate();
	const queryClient = useQueryClient();

	const { mutate, isPending } = useMutation({
		mutationFn: async () => {
			const { document } = await apiFetch<{ document: DocumentSummary }>('/documents', {
				method: 'POST',
			});

			return document;
		},
		onSuccess: async (document) => {
			void queryClient.invalidateQueries({ queryKey: documentsQueryKeys.all });
			await navigate(`/${document._id}`);
		},
		onError: () => {
			toast.add({
				type: 'error',
				title: 'Could not create document',
				description: 'Something went wrong. Please try again.',
			});
		},
	});

	return {
		handleCreateDocument: () => mutate(),
		isCreateDocumentPending: isPending,
	};
};
