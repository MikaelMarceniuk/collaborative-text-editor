/**
 * Text helpers for the document search: turning what a person typed into a query for Mongo's text index, and
 * finding the words in a document to show where they appear. The index ignores case and accents and matches whole
 * words, so these helpers have to find the words the same way, or the snippet would point at the wrong place.
 */

const MAX_TERMS = 10;

/** The words of a search, split on whitespace, without the characters that mean something to Mongo's `$search`. */
export const termsOf = (query: string) =>
	query
		.split(/\s+/)
		// A quote opens a phrase and a leading hyphen negates a word; neither is for the person typing to use
		.map((term) => term.replace(/["\\]/g, '').replace(/^-+/, ''))
		.filter((term) => term.length > 0)
		.slice(0, MAX_TERMS);

/**
 * Every word as its own phrase, which Mongo reads as "all of them". Without the quotes `$search` is an OR, and
 * `plano projeto` would also bring every document that only has one of the two.
 */
export const toSearchString = (terms: string[]) => terms.map((term) => `"${term}"`).join(' ');

interface Folded {
	text: string;
	/** For each character of `text`, where the character it came from starts and ends in the original. */
	starts: number[];
	ends: number[];
}

const isAscii = (character: string) => character.charCodeAt(0) < 128;

// "ç" is "c" plus a combining mark once decomposed; dropping the marks leaves the plain letter
const withoutAccents = (character: string) =>
	character.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/**
 * Lowercase and without accents, like the index sees it. Removing accents or lowercasing can change the length
 * (a letter can decompose into two), so the position of every character in the original is kept.
 */
const fold = (original: string): Folded => {
	const folded: Folded = { text: '', starts: [], ends: [] };
	let position = 0;

	for (const character of original) {
		const next = position + character.length;
		const piece = isAscii(character) ? character.toLowerCase() : withoutAccents(character);

		for (const unit of piece) {
			folded.text += unit;
			// A code point can be two UTF-16 units long, and so can its folded form
			for (let unitIndex = 0; unitIndex < unit.length; unitIndex++) {
				folded.starts.push(position);
				folded.ends.push(next);
			}
		}
		position = next;
	}

	return folded;
};

const WORD = /[\p{L}\p{N}]+/gu;

const wordsOf = (text: string) => text.match(WORD) ?? [];

/** The positions `[start, end)` in `original` of the words that are one of the `terms` (a term can hold several). */
const findWords = (original: string, terms: string[], limit: number): [number, number][] => {
	const wanted = new Set(terms.flatMap((term) => wordsOf(fold(term).text)));
	const { text, starts, ends } = fold(original);
	const found: [number, number][] = [];

	for (const match of text.matchAll(WORD)) {
		if (!wanted.has(match[0])) continue;

		found.push([starts[match.index], ends[match.index + match[0].length - 1]]);
		if (found.length >= limit) break;
	}

	return found;
};

export interface Snippet {
	text: string;
	/** Where the searched words are inside `text`, as `[start, end)` pairs. */
	matches: [number, number][];
}

const CONTEXT_BEFORE = 40;
const CONTEXT_AFTER = 100;
const ELLIPSIS = '…';

/** A short piece of `text` around the first searched word, or null when none of the words is in it. */
export const buildSnippet = (text: string, terms: string[]): Snippet | null => {
	const [first] = findWords(text, terms, 1);
	if (!first) return null;

	// Move the edges to word boundaries when there is one nearby, so the piece does not start in the middle of a word
	let start = Math.max(0, first[0] - CONTEXT_BEFORE);
	if (start > 0) {
		const space = text.indexOf(' ', start);
		start = space !== -1 && space < first[0] ? space + 1 : start;
	}
	let end = Math.min(text.length, first[1] + CONTEXT_AFTER);
	if (end < text.length) {
		const space = text.lastIndexOf(' ', end);
		end = space > first[1] ? space : end;
	}

	const before = start > 0 ? ELLIPSIS : '';
	const after = end < text.length ? ELLIPSIS : '';
	const piece = text.slice(start, end);

	return {
		text: `${before}${piece}${after}`,
		// Looked up again inside the piece, which is short: every word in it is marked, not only the first
		matches: findWords(piece, terms, Infinity).map(
			([from, to]) => [from + before.length, to + before.length] as [number, number],
		),
	};
};
