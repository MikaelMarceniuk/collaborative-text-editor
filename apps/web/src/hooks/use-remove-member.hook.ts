import { useMutation } from '@tanstack/react-query';

import { toast } from '@/components/ui/toast';
import { apiFetch } from '@/lib/api.lib';

import { useDocumentCache } from './use-document-cache.hook';

interface RemoveMemberVariables {
	documentId: string;
	userId: string;
	name: string;
}

// Owner removing someone else from the document
export const useRemoveMember = () => {
	const { updateMembersList, updateSummaryMembers } = useDocumentCache();

	const { mutate, isPending } = useMutation({
		mutationFn: ({ documentId, userId }: RemoveMemberVariables) =>
			apiFetch<void>(`/documents/${documentId}/members/${userId}`, { method: 'DELETE' }),
		onSuccess: (_, { documentId, userId, name }) => {
			const withoutMember = <T extends { userId: string }>(members: T[]) =>
				members.filter((member) => member.userId !== userId);

			updateMembersList(documentId, withoutMember);
			updateSummaryMembers(documentId, withoutMember);
			toast.add({ type: 'success', title: `${name} no longer has access` });
		},
		onError: () => {
			toast.add({
				type: 'error',
				title: 'Could not remove this person',
				description: 'Something went wrong. Please try again.',
			});
		},
	});

	return {
		handleRemoveMember: (variables: RemoveMemberVariables) => mutate(variables),
		isRemoveMemberPending: isPending,
	};
};
