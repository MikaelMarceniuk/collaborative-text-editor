import type { SearchSnippet as Snippet } from '@/hooks/use-search-documents.hook';

interface SearchSnippetProps {
	snippet: Snippet;
}

// The piece of text around the first match, with each searched word marked
export const SearchSnippet = ({ snippet: { text, matches } }: SearchSnippetProps) => {
	const parts: { text: string; isMatch: boolean }[] = [];
	let position = 0;

	for (const [start, end] of matches) {
		if (start > position) parts.push({ text: text.slice(position, start), isMatch: false });
		parts.push({ text: text.slice(start, end), isMatch: true });
		position = end;
	}
	if (position < text.length) parts.push({ text: text.slice(position), isMatch: false });

	return (
		<span className="block truncate text-xs text-muted-foreground">
			{parts.map((part, index) =>
				part.isMatch ? (
					<mark key={index} className="rounded-sm bg-primary/20 px-0.5 text-foreground">
						{part.text}
					</mark>
				) : (
					part.text
				),
			)}
		</span>
	);
};
