import { useMutation } from '@tanstack/react-query';

import { toast } from '@/components/ui/toast';
import { apiFetch } from '@/lib/api.lib';

import { useDocumentCache } from './use-document-cache.hook';
import type { DocumentRole } from './use-documents.hook';

interface UpdateMemberRoleVariables {
	documentId: string;
	userId: string;
	role: Exclude<DocumentRole, 'owner'>;
}

export const useUpdateMemberRole = () => {
	const { updateMembersList, updateSummaryMembers } = useDocumentCache();

	const { mutate, isPending } = useMutation({
		mutationFn: ({ documentId, userId, role }: UpdateMemberRoleVariables) =>
			apiFetch<void>(`/documents/${documentId}/members/${userId}`, {
				method: 'PATCH',
				body: JSON.stringify({ role }),
			}),
		onSuccess: (_, { documentId, userId, role }) => {
			const withNewRole = <T extends { userId: string; role: DocumentRole }>(members: T[]) =>
				members.map((member) => (member.userId === userId ? { ...member, role } : member));

			updateMembersList(documentId, withNewRole);
			updateSummaryMembers(documentId, withNewRole);
		},
		onError: () => {
			toast.add({
				type: 'error',
				title: 'Could not change the role',
				description: 'Something went wrong. Please try again.',
			});
		},
	});

	return {
		handleUpdateMemberRole: (variables: UpdateMemberRoleVariables) => mutate(variables),
		isUpdateMemberRolePending: isPending,
	};
};
