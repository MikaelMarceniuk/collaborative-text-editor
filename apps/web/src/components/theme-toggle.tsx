import { IconMoon, IconSun } from '@tabler/icons-react';

import { Button } from '@/components/ui/button';
import { useTheme } from '@/hooks/use-theme.hook';

export const ThemeToggle = () => {
	const { setTheme } = useTheme();

	const handleToggle = () =>
		setTheme(document.documentElement.classList.contains('dark') ? 'light' : 'dark');

	return (
		<Button variant="ghost" size="icon" aria-label="Toggle theme" onClick={handleToggle}>
			<IconSun className="dark:hidden" />
			<IconMoon className="hidden dark:block" />
		</Button>
	);
};
