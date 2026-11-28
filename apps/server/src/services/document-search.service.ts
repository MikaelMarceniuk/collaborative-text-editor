import type { ObjectId } from 'mongodb';

import { collections } from '../config/mongodb.js';
import type { DocumentModel } from '../models/document.model.js';
import { buildSnippet, type Snippet, termsOf, toSearchString } from './search-text.js';

export const MAX_SEARCH_RESULTS = 20;

export type SearchResult = Omit<DocumentModel, 'ydocState' | 'searchText'> & {
	/** Null when only the title matched. */
	snippet: Snippet | null;
};

/**
 * The documents `userId` is a member of that have all the words of `query`, in the title or in the text, best
 * first. The title weighs more than the text (see the index in config/mongodb.ts).
 */
export const searchDocuments = async (userId: ObjectId, query: string) => {
	const terms = termsOf(query);
	if (terms.length === 0) return [];

	const documents = await collections.documents
		.find<DocumentModel & { score: number }>(
			{ 'members.userId': userId, $text: { $search: toSearchString(terms) } },
			{ projection: { ydocState: 0, score: { $meta: 'textScore' } } },
		)
		.sort({ score: { $meta: 'textScore' } })
		.limit(MAX_SEARCH_RESULTS)
		.toArray();

	// The text and the score were only needed here: for the snippet and for the order
	return documents.map(({ searchText, score: _score, ...document }): SearchResult => ({
		...document,
		snippet: searchText ? buildSnippet(searchText, terms) : null,
	}));
};
