import { useMutation, useQueryClient } from '@tanstack/react-query';

import { toast } from '@/components/ui/toast';
import { ApiError, apiFetch } from '@/lib/api.lib';

import { documentsQueryKeys } from './use-documents.hook';
import { useAuthenticatedSession } from './use-session.hook';

interface CreateVersionVariables {
	documentId: string;
	label?: string;
}

const getCreateVersionErrorMessage = (error: Error) => {
	if (error instanceof ApiError) {
		if (error.status === 429) return 'Too many versions saved. Try again later.';
		// 400 carries a message written for the user (an empty document, a label that is too long)
		if (error.status === 400) return error.message;
	}

	return 'Something went wrong. Please try again.';
};

export const useCreateVersion = () => {
	const { user } = useAuthenticatedSession();
	const queryClient = useQueryClient();

	const { mutate, isPending, error, reset } = useMutation({
		mutationFn: ({ documentId, label }: CreateVersionVariables) =>
			apiFetch<void>(`/documents/${documentId}/versions`, {
				method: 'POST',
				body: JSON.stringify({ label }),
			}),
		onSuccess: (_, { documentId }) => {
			void queryClient.invalidateQueries({
				queryKey: documentsQueryKeys.versions(user.id, documentId),
			});
			toast.add({ type: 'success', title: 'Version saved' });
		},
	});

	const handleCreateVersion = (
		variables: CreateVersionVariables,
		options?: { onSuccess?: () => void },
	) => mutate(variables, options);

	return {
		handleCreateVersion,
		isCreateVersionPending: isPending,
		createVersionError: error ? getCreateVersionErrorMessage(error) : null,
		resetCreateVersionError: reset,
	};
};
