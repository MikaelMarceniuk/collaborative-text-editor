import { useMutation, useQueryClient } from '@tanstack/react-query';

import { toast } from '@/components/ui/toast';
import { apiFetch } from '@/lib/api.lib';

import { documentsQueryKeys, type DocumentSummary } from './use-documents.hook';
import { useAuthenticatedSession } from './use-session.hook';

interface RenameDocumentVariables {
	documentId: string;
	title: string;
}

export const useRenameDocument = () => {
	const { user } = useAuthenticatedSession();
	const queryClient = useQueryClient();

	const listKey = documentsQueryKeys.list(user.id);
	const detailKey = (documentId: string) => documentsQueryKeys.detail(user.id, documentId);

	const setDocumentInCache = (document: DocumentSummary) => {
		queryClient.setQueryData<DocumentSummary>(detailKey(document._id), document);
		queryClient.setQueryData<DocumentSummary[]>(listKey, (documents) =>
			documents?.map((current) => (current._id === document._id ? document : current)),
		);
	};

	const { mutate, isPending } = useMutation({
		mutationFn: async ({ documentId, title }: RenameDocumentVariables) => {
			const { document } = await apiFetch<{ document: DocumentSummary }>(
				`/documents/${documentId}`,
				{ method: 'PATCH', body: JSON.stringify({ title }) },
			);

			return document;
		},
		onMutate: async ({ documentId, title }) => {
			await Promise.all([
				queryClient.cancelQueries({ queryKey: detailKey(documentId), exact: true }),
				queryClient.cancelQueries({ queryKey: listKey, exact: true }),
			]);

			const previousDocument = queryClient.getQueryData<DocumentSummary>(detailKey(documentId));
			const previousDocuments = queryClient.getQueryData<DocumentSummary[]>(listKey);

			queryClient.setQueryData<DocumentSummary>(
				detailKey(documentId),
				(document) => document && { ...document, title },
			);
			queryClient.setQueryData<DocumentSummary[]>(listKey, (documents) =>
				documents?.map((document) =>
					document._id === documentId ? { ...document, title } : document,
				),
			);

			return { previousDocument, previousDocuments };
		},
		onSuccess: setDocumentInCache,
		onError: (_, { documentId }, context) => {
			queryClient.setQueryData(detailKey(documentId), context?.previousDocument);
			queryClient.setQueryData(listKey, context?.previousDocuments);
			toast.add({
				type: 'error',
				title: 'Could not rename document',
				description: 'Something went wrong. Please try again.',
			});
		},
	});

	const handleRenameDocument = (documentId: string, title: string) => mutate({ documentId, title });

	return {
		handleRenameDocument,
		isRenameDocumentPending: isPending,
	};
};
