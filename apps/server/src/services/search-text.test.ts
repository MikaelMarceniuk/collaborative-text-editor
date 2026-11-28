import { describe, expect, it } from 'vitest';

import { buildSnippet, termsOf, toSearchString } from './search-text.js';

const marked = (text: string, terms: string[]) => {
	const snippet = buildSnippet(text, terms);
	return snippet?.matches.map(([start, end]) => snippet.text.slice(start, end));
};

describe('termsOf', () => {
	it('splits on whitespace', () => {
		expect(termsOf('  plano   projeto\tfinal ')).toEqual(['plano', 'projeto', 'final']);
	});

	it('removes what would change the meaning of the search in Mongo', () => {
		expect(termsOf('"quoted" -negated --twice back\\slash')).toEqual([
			'quoted',
			'negated',
			'twice',
			'backslash',
		]);
	});

	it('keeps a hyphen inside a word', () => {
		expect(termsOf('e-mail')).toEqual(['e-mail']);
	});

	it('drops what is left empty and caps the number of words', () => {
		expect(termsOf('" - \\')).toEqual([]);
		expect(termsOf(Array.from({ length: 30 }, (_, i) => `w${i}`).join(' '))).toHaveLength(10);
	});
});

describe('toSearchString', () => {
	it('puts every word in its own phrase, so Mongo wants all of them', () => {
		expect(toSearchString(['plano', 'e-mail'])).toBe('"plano" "e-mail"');
	});
});

describe('buildSnippet', () => {
	it('is null when no word is in the text', () => {
		expect(buildSnippet('nothing to see here', ['missing'])).toBeNull();
	});

	it('finds a word ignoring case and accents, and points at it in the original text', () => {
		const snippet = buildSnippet('Uma reunião de CORAÇÃO aberto', ['coracao']);

		expect(snippet?.text).toBe('Uma reunião de CORAÇÃO aberto');
		expect(snippet?.matches).toEqual([[15, 22]]);
		expect(snippet?.text.slice(15, 22)).toBe('CORAÇÃO');
	});

	it('finds a word written with accents when the search has none, and the other way round', () => {
		expect(marked('coracao', ['CORAÇÃO'])).toEqual(['coracao']);
	});

	it('only matches whole words', () => {
		expect(buildSnippet('projetos futuros', ['projeto'])).toBeNull();
		expect(marked('o projeto, os projetos', ['projeto'])).toEqual(['projeto']);
	});

	it('finds a word next to punctuation, like the index does', () => {
		expect(marked('write an e-mail (today)', ['mail', 'today'])).toEqual(['mail', 'today']);
	});

	it('marks every searched word that is in the piece', () => {
		expect(marked('plano A e plano B do projeto', ['plano', 'projeto'])).toEqual([
			'plano',
			'plano',
			'projeto',
		]);
	});

	it('stays in step when folding changes the length of the text', () => {
		// "İ" (dotted capital I) becomes two characters once lowercased
		const snippet = buildSnippet('İstanbul trip and a word', ['word']);

		expect(snippet?.text.slice(...snippet.matches[0]!)).toBe('word');
	});

	it('cuts a piece around the first word, with an ellipsis where text was left out', () => {
		const text = `${'before '.repeat(50)}needle ${'after '.repeat(50)}`.trim();

		const snippet = buildSnippet(text, ['needle'])!;

		expect(snippet.text.length).toBeLessThan(200);
		expect(snippet.text.startsWith('…')).toBe(true);
		expect(snippet.text.endsWith('…')).toBe(true);
		expect(snippet.text.slice(...snippet.matches[0]!)).toBe('needle');
	});

	it('does not start or end in the middle of a word when it can avoid it', () => {
		const text = `${'abcdefghi '.repeat(30)}needle ${'jklmnopqr '.repeat(30)}`.trim();

		const snippet = buildSnippet(text, ['needle'])!;
		const [first, last] = [snippet.text.split(' ')[0]!, snippet.text.split(' ').at(-1)!];

		expect(first).toMatch(/^…(abcdefghi)$/);
		expect(last).toMatch(/^jklmnopqr…$/);
	});

	it('has no ellipsis when the whole text fits', () => {
		const snippet = buildSnippet('short text with word', ['word'])!;

		expect(snippet.text).toBe('short text with word');
	});
});
