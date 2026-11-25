import { IconDoorExit, IconLoader2 } from '@tabler/icons-react';

import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogMedia,
	AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import type { DocumentSummary } from '@/hooks/use-documents.hook';
import { useLeaveDocument } from '@/hooks/use-leave-document.hook';

interface LeaveDocumentDialogProps {
	document: DocumentSummary | null;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	// Called once the user has left, so the caller can close what was showing the document
	onLeft?: () => void;
}

export const LeaveDocumentDialog = ({
	document,
	open,
	onOpenChange,
	onLeft,
}: LeaveDocumentDialogProps) => {
	const { handleLeaveDocument, isLeaveDocumentPending } = useLeaveDocument();

	return (
		<AlertDialog
			open={open}
			onOpenChange={(nextOpen) => !isLeaveDocumentPending && onOpenChange(nextOpen)}
		>
			<AlertDialogContent size="sm">
				<AlertDialogHeader>
					<AlertDialogMedia>
						<IconDoorExit />
					</AlertDialogMedia>
					<AlertDialogTitle>Leave document?</AlertDialogTitle>
					<AlertDialogDescription>
						You will lose access to{' '}
						<span className="font-medium text-foreground">{document?.title}</span>. The owner can
						invite you again.
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel disabled={isLeaveDocumentPending}>Cancel</AlertDialogCancel>
					<AlertDialogAction
						variant="destructive"
						disabled={isLeaveDocumentPending}
						onClick={() =>
							document &&
							handleLeaveDocument(document._id, {
								onSuccess: () => {
									onOpenChange(false);
									onLeft?.();
								},
							})
						}
					>
						{isLeaveDocumentPending && <IconLoader2 className="animate-spin" />}
						Leave
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
};
