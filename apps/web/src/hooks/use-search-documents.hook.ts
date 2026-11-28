import { keepPreviousData, queryOptions, useQuery } from '@tanstack/react-query';

import { apiFetch } from '@/lib/api.lib';

import { useDebouncedValue } from './use-debounced-value.hook';
import { type DocumentSummary, documentsQueryKeys } from './use-documents.hook';
import { useAuthenticatedSession } from './use-session.hook';

// Where the searched words are in the text, as [start, end) pairs
export interface SearchSnippet {
	text: string;
	matches: [number, number][];
}

export interface SearchedDocument extends DocumentSummary {
	// Null when only the title matched
	snippet: SearchSnippet | null;
}

// Typing is not a search for every letter: it waits for a pause
const SEARCH_DEBOUNCE_MS = 300;

const fetchSearch = async (query: string, signal: AbortSignal) => {
	const { documents } = await apiFetch<{ documents: SearchedDocument[] }>(
		`/documents/search?q=${encodeURIComponent(query)}`,
		{ signal },
	);

	return documents;
};

export const searchDocumentsQueryOptions = (userId: string, query: string) =>
	queryOptions({
		queryKey: documentsQueryKeys.search(userId, query),
		queryFn: ({ signal }) => fetchSearch(query, signal),
	});

export const useSearchDocuments = (text: string) => {
	const { user } = useAuthenticatedSession();
	const query = text.trim();
	const settledQuery = useDebouncedValue(query, SEARCH_DEBOUNCE_MS);

	const { data, isError, isFetching, refetch } = useQuery({
		...searchDocumentsQueryOptions(user.id, settledQuery),
		enabled: settledQuery.length > 0,
		// The previous results stay on screen while the next ones load, so the list does not blink at every pause
		placeholderData: keepPreviousData,
	});

	return {
		isSearching: query.length > 0,
		// Nothing to show yet: no search has finished since the person started typing
		isSearchPending: query.length > 0 && data === undefined && !isError,
		isSearchError: query.length > 0 && isError && !isFetching,
		// Waiting for the pause, or for the answer
		isSearchUpdating: query.length > 0 && (query !== settledQuery || isFetching),
		searchResults: data ?? [],
		refetchSearch: refetch,
	};
};
