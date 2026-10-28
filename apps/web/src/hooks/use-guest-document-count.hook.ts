import { useQuery } from '@tanstack/react-query';

import { documentsQueryOptions } from './use-documents.hook';
import { useSession } from './use-session.hook';

export const useGuestDocumentCount = () => {
	const user = useSession()?.user;
	const isGuest = Boolean(user?.isAnonymous);

	const { data } = useQuery({
		...documentsQueryOptions(user?.id ?? ''),
		select: (documents) => documents.length,
		enabled: isGuest,
	});

	return isGuest ? (data ?? null) : null;
};

export const formatGuestDocuments = (count: number | null) => {
	if (count === null) return 'Your documents';
	if (count === 1) return 'Your document';

	return `Your ${count} documents`;
};
