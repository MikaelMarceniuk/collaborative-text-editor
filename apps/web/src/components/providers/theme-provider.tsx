import { useEffect, useState } from 'react';

import { ThemeContext, type Theme } from '@/hooks/use-theme.hook';

const STORAGE_KEY = 'collaborative-text-editor/v1/theme';

const getStoredTheme = (): Theme => (localStorage.getItem(STORAGE_KEY) as Theme | null) ?? 'system';

export const ThemeProvider = ({ children }: { children: React.ReactNode }) => {
	const [theme, setThemeState] = useState<Theme>(getStoredTheme);

	useEffect(() => {
		const media = window.matchMedia('(prefers-color-scheme: dark)');
		const apply = () => {
			const isDark = theme === 'dark' || (theme === 'system' && media.matches);
			document.documentElement.classList.toggle('dark', isDark);
		};

		apply();
		if (theme !== 'system') return;
		media.addEventListener('change', apply);
		return () => media.removeEventListener('change', apply);
	}, [theme]);

	const setTheme = (next: Theme) => {
		localStorage.setItem(STORAGE_KEY, next);
		setThemeState(next);
	};

	return <ThemeContext value={{ theme, setTheme }}>{children}</ThemeContext>;
};
