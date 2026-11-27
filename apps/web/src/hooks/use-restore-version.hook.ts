import { useMutation, useQueryClient } from '@tanstack/react-query';

import { toast } from '@/components/ui/toast';
import { ApiError, apiFetch } from '@/lib/api.lib';

import { documentsQueryKeys } from './use-documents.hook';
import { useAuthenticatedSession } from './use-session.hook';

interface RestoreVersionVariables {
	documentId: string;
	versionId: string;
}

export const useRestoreVersion = () => {
	const { user } = useAuthenticatedSession();
	const queryClient = useQueryClient();

	const { mutate, isPending } = useMutation({
		mutationFn: ({ documentId, versionId }: RestoreVersionVariables) =>
			apiFetch<void>(`/documents/${documentId}/versions/${versionId}/restore`, { method: 'POST' }),
		onSuccess: (_, { documentId }) => {
			// The content changes by itself in the editor, it arrives through the socket like any edit. The server
			// kept the content it had before, which is a new version in the list
			void queryClient.invalidateQueries({
				queryKey: documentsQueryKeys.versions(user.id, documentId),
			});
			toast.add({ type: 'success', title: 'Version restored' });
		},
		onError: (error) => {
			toast.add({
				type: 'error',
				title: 'Could not restore the version',
				description:
					error instanceof ApiError && error.status === 429
						? 'Too many versions saved. Try again later.'
						: 'Something went wrong. Please try again.',
			});
		},
	});

	const handleRestoreVersion = (
		variables: RestoreVersionVariables,
		options?: { onSuccess?: () => void },
	) => mutate(variables, options);

	return { handleRestoreVersion, isRestoreVersionPending: isPending };
};
