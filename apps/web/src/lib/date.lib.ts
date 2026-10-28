const relativeTimeFormat = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
	['year', 60 * 60 * 24 * 365],
	['month', 60 * 60 * 24 * 30],
	['week', 60 * 60 * 24 * 7],
	['day', 60 * 60 * 24],
	['hour', 60 * 60],
	['minute', 60],
];

export const formatRelativeTime = (date: string | Date) => {
	const seconds = (new Date(date).getTime() - Date.now()) / 1000;

	for (const [unit, unitSeconds] of UNITS) {
		if (Math.abs(seconds) >= unitSeconds) {
			return relativeTimeFormat.format(Math.trunc(seconds / unitSeconds), unit);
		}
	}

	return 'just now';
};
