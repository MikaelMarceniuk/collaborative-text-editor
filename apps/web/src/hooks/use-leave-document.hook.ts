import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';

import { toast } from '@/components/ui/toast';
import { apiFetch } from '@/lib/api.lib';

import { documentsQueryKeys, type DocumentSummary } from './use-documents.hook';
import { useAuthenticatedSession } from './use-session.hook';

// A member that is not the owner removing themself from the document
export const useLeaveDocument = () => {
	const { user } = useAuthenticatedSession();
	const queryClient = useQueryClient();
	const navigate = useNavigate();

	const { mutate, isPending } = useMutation({
		mutationFn: (documentId: string) =>
			apiFetch<void>(`/documents/${documentId}/members/${user.id}`, { method: 'DELETE' }),
		onSuccess: async (_, documentId) => {
			queryClient.setQueryData<DocumentSummary[]>(documentsQueryKeys.list(user.id), (documents) =>
				documents?.filter((document) => document._id !== documentId),
			);
			// The detail, content and members of the document are not reachable anymore
			queryClient.removeQueries({ queryKey: documentsQueryKeys.detail(user.id, documentId) });
			toast.add({ type: 'success', title: 'You left the document' });
			await navigate('/');
		},
		onError: () => {
			toast.add({
				type: 'error',
				title: 'Could not leave the document',
				description: 'Something went wrong. Please try again.',
			});
		},
	});

	return {
		handleLeaveDocument: (documentId: string, options?: { onSuccess?: () => void }) =>
			mutate(documentId, options),
		isLeaveDocumentPending: isPending,
	};
};
