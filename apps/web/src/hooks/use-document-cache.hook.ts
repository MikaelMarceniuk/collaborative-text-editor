import { useQueryClient } from '@tanstack/react-query';

import type { DocumentMemberDetails } from './use-document-members.hook';
import {
	type DocumentMember,
	documentsQueryKeys,
	type DocumentSummary,
} from './use-documents.hook';
import { useAuthenticatedSession } from './use-session.hook';

// Keeps the three cached views of a document's members in sync after a change:
// the members list of the share dialog, and the `members` of the document summary
// (detail and list), which the editor and the documents list use for roles and badges.
export const useDocumentCache = () => {
	const { user } = useAuthenticatedSession();
	const queryClient = useQueryClient();

	const updateMembersList = (
		documentId: string,
		update: (members: DocumentMemberDetails[]) => DocumentMemberDetails[],
	) =>
		queryClient.setQueryData<DocumentMemberDetails[]>(
			documentsQueryKeys.members(user.id, documentId),
			(members) => members && update(members),
		);

	const updateSummaryMembers = (
		documentId: string,
		update: (members: DocumentMember[]) => DocumentMember[],
	) => {
		queryClient.setQueryData<DocumentSummary>(
			documentsQueryKeys.detail(user.id, documentId),
			(document) => document && { ...document, members: update(document.members) },
		);
		queryClient.setQueryData<DocumentSummary[]>(documentsQueryKeys.list(user.id), (documents) =>
			documents?.map((document) =>
				document._id === documentId ? { ...document, members: update(document.members) } : document,
			),
		);
	};

	return { updateMembersList, updateSummaryMembers };
};
