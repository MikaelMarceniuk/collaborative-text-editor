import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { CONTENT_FIELD } from './document-content.service.js';
import { extractText, MAX_SEARCH_TEXT_LENGTH } from './extract-text.js';

const paragraph = (text: string) => {
	const element = new Y.XmlElement('paragraph');
	element.insert(0, [new Y.XmlText(text)]);
	return element;
};

const fragmentWith = (nodes: (Y.XmlElement | Y.XmlText)[]) => {
	const ydoc = new Y.Doc();
	const fragment = ydoc.getXmlFragment(CONTENT_FIELD);
	fragment.insert(0, nodes);
	return fragment;
};

describe('extractText', () => {
	it('is empty for an empty document', () => {
		expect(extractText(fragmentWith([]))).toBe('');
	});

	it('keeps paragraphs apart, so the last word of one does not join the first of the next', () => {
		expect(extractText(fragmentWith([paragraph('end'), paragraph('start')]))).toBe('end start');
	});

	it('reads text inside nested elements, in document order', () => {
		const item = (text: string) => {
			const listItem = new Y.XmlElement('listItem');
			listItem.insert(0, [paragraph(text)]);
			return listItem;
		};
		const list = new Y.XmlElement('bulletList');
		list.insert(0, [item('one'), item('two')]);

		expect(extractText(fragmentWith([paragraph('before'), list, paragraph('after')]))).toBe(
			'before one two after',
		);
	});

	it('does not split a word where the formatting changes', () => {
		const text = new Y.XmlText();
		text.insert(0, 'bold', { bold: true });
		text.insert(4, 'ness is plain');
		const element = new Y.XmlElement('paragraph');
		element.insert(0, [text]);

		expect(extractText(fragmentWith([element]))).toBe('boldness is plain');
	});

	it('skips embeds, which have no text', () => {
		const text = new Y.XmlText();
		const element = new Y.XmlElement('paragraph');
		element.insert(0, [text]);
		const fragment = fragmentWith([element]);
		text.insert(0, 'before ');
		text.insertEmbed(7, { src: 'cat.png' });
		text.insert(8, ' after');

		expect(extractText(fragment)).toBe('before after');
	});

	it('collapses runs of whitespace and line breaks', () => {
		expect(extractText(fragmentWith([paragraph('  a \n\n  b\t\tc  ')]))).toBe('a b c');
	});

	it('is cut at the limit', () => {
		const text = extractText(fragmentWith([paragraph('a '.repeat(MAX_SEARCH_TEXT_LENGTH))]));

		expect(text).toHaveLength(MAX_SEARCH_TEXT_LENGTH);
	});

	it('does not run out of stack on deeply nested content', () => {
		const ydoc = new Y.Doc();
		const fragment = ydoc.getXmlFragment(CONTENT_FIELD);
		let parent: Y.XmlFragment | Y.XmlElement = fragment;
		// Each element is inserted into one that is already part of the document, which does not recurse
		ydoc.transact(() => {
			for (let depth = 0; depth < 20_000; depth++) {
				const child: Y.XmlElement = new Y.XmlElement('blockquote');
				parent.insert(0, [child]);
				parent = child;
			}
			parent.insert(0, [new Y.XmlText('at the bottom')]);
		});

		expect(extractText(fragment)).toBe('at the bottom');
	});
});
