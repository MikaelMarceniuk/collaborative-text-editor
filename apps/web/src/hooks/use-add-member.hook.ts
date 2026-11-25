import { useMutation } from '@tanstack/react-query';

import { toast } from '@/components/ui/toast';
import { ApiError, apiFetch } from '@/lib/api.lib';

import { useDocumentCache } from './use-document-cache.hook';
import type { DocumentMemberDetails } from './use-document-members.hook';
import type { DocumentRole } from './use-documents.hook';

interface AddMemberVariables {
	documentId: string;
	email: string;
	role: Exclude<DocumentRole, 'owner'>;
}

const getAddMemberErrorMessage = (error: Error) => {
	if (error instanceof ApiError) {
		if (error.status === 404) return 'No account with this email.';
		if (error.status === 409) return 'This person already has access.';
		if (error.status === 429) return 'Too many invites. Try again later.';
		// 400 and 403 carry a message written for the user (guests, inviting yourself, invalid email)
		if (error.status === 400 || error.status === 403) return error.message;
	}

	return 'Something went wrong. Please try again.';
};

export const useAddMember = () => {
	const { updateMembersList, updateSummaryMembers } = useDocumentCache();

	const { mutate, isPending, error, reset } = useMutation({
		mutationFn: async ({ documentId, email, role }: AddMemberVariables) => {
			const { member } = await apiFetch<{ member: DocumentMemberDetails }>(
				`/documents/${documentId}/members`,
				{ method: 'POST', body: JSON.stringify({ email, role }) },
			);

			return member;
		},
		onSuccess: (member, { documentId }) => {
			updateMembersList(documentId, (members) => [...members, member]);
			updateSummaryMembers(documentId, (members) => [
				...members,
				{ userId: member.userId, role: member.role },
			]);
			toast.add({ type: 'success', title: `Shared with ${member.name}` });
		},
	});

	const handleAddMember = (variables: AddMemberVariables, options?: { onSuccess?: () => void }) =>
		mutate(variables, options);

	return {
		handleAddMember,
		isAddMemberPending: isPending,
		addMemberError: error ? getAddMemberErrorMessage(error) : null,
		resetAddMemberError: reset,
	};
};
