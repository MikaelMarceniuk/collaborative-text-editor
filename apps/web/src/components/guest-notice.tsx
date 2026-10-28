import { IconInfoCircle } from '@tabler/icons-react';
import { cn } from 'cn';

interface GuestNoticeProps extends React.ComponentProps<'div'> {
	action?: React.ReactNode;
}

export const GuestNotice: React.FC<GuestNoticeProps> = ({
	action,
	children,
	className,
	...props
}) => {
	return (
		<div
			role="note"
			className={cn(
				'flex items-start gap-2 rounded-lg border bg-muted/50 p-3 text-left text-sm text-muted-foreground',
				className,
			)}
			{...props}
		>
			<IconInfoCircle className="mt-0.5 size-4 shrink-0" />
			<div className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
				<p className="text-balance">{children}</p>
				{action}
			</div>
		</div>
	);
};
