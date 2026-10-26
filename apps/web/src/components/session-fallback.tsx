import { IconLoader2 } from '@tabler/icons-react';

export const SessionFallback = () => {
	return (
		<div className="flex min-h-svh items-center justify-center gap-2 text-sm text-muted-foreground">
			<IconLoader2 className="size-4 animate-spin" />
			Fetching session…
		</div>
	);
};
