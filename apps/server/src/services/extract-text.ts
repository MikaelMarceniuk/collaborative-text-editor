import * as Y from 'yjs';

/** The text kept for the search index is cut here: the index holds one entry per word, so a huge document would bloat it. */
export const MAX_SEARCH_TEXT_LENGTH = 100_000;

// Marks the end of an element in the work list, so the text of two paragraphs does not run together
const END_OF_ELEMENT = Symbol('end of element');

/**
 * The plain text of the editor content, for the search index: paragraphs, headings, list items and so on, in order,
 * with a space where each element ends. Formatting is dropped and embeds (images) have no text.
 *
 * It walks the tree with a work list instead of recursing: the content comes from clients, and a deeply nested
 * document must cost time, not stack.
 */
export const extractText = (fragment: Y.XmlFragment) => {
	let text = '';
	const pending: (Y.XmlElement | Y.XmlText | Y.XmlHook | typeof END_OF_ELEMENT)[] = [
		...fragment.toArray(),
	].reverse();

	while (pending.length > 0 && text.length <= MAX_SEARCH_TEXT_LENGTH) {
		const node = pending.pop();

		if (node === END_OF_ELEMENT) {
			text += ' ';
		} else if (node instanceof Y.XmlText) {
			// Marks (bold, links) are attributes of pieces of one XmlText: the delta is what joins them back
			for (const piece of node.toDelta() as { insert?: unknown }[]) {
				if (typeof piece.insert === 'string') text += piece.insert;
			}
		} else if (node instanceof Y.XmlElement) {
			// Pushed in reverse so the first child is the next one popped, and the end marker comes after the last
			pending.push(END_OF_ELEMENT, ...node.toArray().reverse());
		}
	}

	return text.replace(/\s+/g, ' ').trim().slice(0, MAX_SEARCH_TEXT_LENGTH);
};
