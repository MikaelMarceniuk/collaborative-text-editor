import { IconCloudCheck, IconCloudOff, IconCloudUp } from '@tabler/icons-react';
import { cn } from 'cn';

import type { SaveStatus } from '@/lib/document-socket.lib';

const saveStatusContent = {
	saved: { icon: IconCloudCheck, label: 'Saved' },
	saving: { icon: IconCloudUp, label: 'Saving…' },
	offline: { icon: IconCloudOff, label: 'Offline' },
} satisfies Record<SaveStatus, { icon: typeof IconCloudCheck; label: string }>;

export const SaveStatusIndicator = ({ status }: { status: SaveStatus }) => {
	const { icon: Icon, label } = saveStatusContent[status];

	return (
		<div
			role="status"
			title={label}
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
