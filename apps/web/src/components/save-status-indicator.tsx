import { IconCloudCheck, IconCloudUp, IconCloudX } from '@tabler/icons-react';
import { cn } from 'cn';

import type { SaveStatus } from '@/lib/document-sync.lib';

const saveStatusContent = {
	saved: { icon: IconCloudCheck, label: 'Saved' },
	saving: { icon: IconCloudUp, label: 'Saving…' },
	error: { icon: IconCloudX, label: "Couldn't save" },
} satisfies Record<SaveStatus, { icon: typeof IconCloudCheck; label: string }>;

export const SaveStatusIndicator = ({ status }: { status: SaveStatus }) => {
	const { icon: Icon, label } = saveStatusContent[status];

	return (
		<div
			role="status"
			title={label}
			className={cn(
				'flex items-center gap-1.5 px-2 text-sm text-muted-foreground',
				status === 'error' && 'text-destructive',
			)}
		>
			<Icon className="size-4" />
			<span className="max-sm:sr-only">{label}</span>
		</div>
	);
};
