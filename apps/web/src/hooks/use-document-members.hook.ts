import { queryOptions, useQuery } from '@tanstack/react-query';

import { apiFetch } from '@/lib/api.lib';

import { type DocumentRole, documentsQueryKeys } from './use-documents.hook';
import { useAuthenticatedSession } from './use-session.hook';

// A member as the share dialog shows it: the document only stores userId + role,
// the server adds the name and email from the user's account.
export interface DocumentMemberDetails {
	userId: string;
	role: DocumentRole;
	name: string;
	email: string;
	image?: string;
}

const fetchDocumentMembers = async (documentId: string, signal: AbortSignal) => {
	const { members } = await apiFetch<{ members: DocumentMemberDetails[] }>(
		`/documents/${documentId}/members`,
		{ signal },
	);

	return members;
};

export const documentMembersQueryOptions = (userId: string, documentId: string) =>
	queryOptions({
		queryKey: documentsQueryKeys.members(userId, documentId),
		queryFn: ({ signal }) => fetchDocumentMembers(documentId, signal),
	});

interface UseDocumentMembersOptions {
	// The list is only fetched while the share dialog is open
	enabled?: boolean;
}

export const useDocumentMembers = (
	documentId: string | undefined,
	{ enabled = true }: UseDocumentMembersOptions = {},
) => {
	const { user } = useAuthenticatedSession();
	const { data, isPending, isError, isFetching, refetch } = useQuery({
		...documentMembersQueryOptions(user.id, documentId ?? ''),
		enabled: enabled && Boolean(documentId),
	});

	return {
		members: data ?? [],
		isMembersPending: isPending || (isError && isFetching),
		isMembersError: isError && !isFetching,
		refetchMembers: refetch,
	};
};
