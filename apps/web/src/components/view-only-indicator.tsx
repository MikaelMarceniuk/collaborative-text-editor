import { IconEye } from '@tabler/icons-react';

export const ViewOnlyIndicator = () => (
	<div
		role="status"
		title="You can read this document but not edit it"
		className="flex items-center gap-1.5 px-2 text-sm text-muted-foreground"
	>
		<IconEye className="size-4" />
		<span className="max-sm:sr-only">View only</span>
	</div>
);
