import { useEffect, useState } from 'react';

/** `value`, but only after it has stopped changing for `delayMs`. */
export const useDebouncedValue = <T>(value: T, delayMs: number) => {
	const [debounced, setDebounced] = useState(value);

	useEffect(() => {
		const timeout = setTimeout(() => setDebounced(value), delayMs);

		return () => clearTimeout(timeout);
	}, [value, delayMs]);

	return debounced;
};
