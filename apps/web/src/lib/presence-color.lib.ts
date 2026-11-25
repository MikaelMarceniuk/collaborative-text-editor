// Dark enough for white text on top (the name label of a cursor), and readable in the light and dark themes
const PRESENCE_COLORS = [
	'#b91c1c',
	'#c2410c',
	'#a16207',
	'#15803d',
	'#0f766e',
	'#0369a1',
	'#4338ca',
	'#7e22ce',
	'#be185d',
	'#475569',
];

/** Always the same color for the same user, in every tab and every document. */
export const getPresenceColor = (userId: string) => {
	let hash = 0;
	for (const char of userId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;

	return PRESENCE_COLORS[hash % PRESENCE_COLORS.length]!;
};
