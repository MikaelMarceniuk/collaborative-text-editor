import { IconCloudCheck, IconCloudOff, IconCloudUp } from '@tabler/icons-react';
import { cn } from 'cn';

import type { SaveStatus } from '@/lib/document-socket.lib';

const saveStatusContent = {
	saved: { icon: IconCloudCheck, label: 'Saved', title: 'All changes are saved' },
	saving: { icon: IconCloudUp, label: 'Saving…', title: 'Saving your changes' },
	offline: {
		icon: IconCloudOff,
		label: 'Offline',
		title: 'Connection lost. Your changes will sync when you are back online',
	},
} satisfies Record<SaveStatus, { icon: typeof IconCloudCheck; label: string; title: string }>;

export const SaveStatusIndicator = ({ status }: { status: SaveStatus }) => {
	const { icon: Icon, label, title } = saveStatusContent[status];

	return (
		<div
			role="status"
			title={title}
			className={cn(
				'flex items-center gap-1.5 px-2 text-sm text-muted-foreground',
				status === 'offline' && 'text-destructive',
			)}
		>
			<Icon className="size-4" />
			<span className="max-sm:sr-only">{label}</span>
		</div>
	);
};
