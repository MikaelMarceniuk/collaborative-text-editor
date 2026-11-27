import { IconHistory, IconLoader2 } from '@tabler/icons-react';

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
import { useRestoreVersion } from '@/hooks/use-restore-version.hook';

interface RestoreVersionDialogProps {
	documentId: string;
	// What is being restored, for the text. Null while the dialog is closed
	versionId: string | null;
	versionTitle: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onRestored: () => void;
}

export const RestoreVersionDialog = ({
	documentId,
	versionId,
	versionTitle,
	open,
	onOpenChange,
	onRestored,
}: RestoreVersionDialogProps) => {
	const { handleRestoreVersion, isRestoreVersionPending } = useRestoreVersion();

	return (
		<AlertDialog
			open={open}
			onOpenChange={(nextOpen) => !isRestoreVersionPending && onOpenChange(nextOpen)}
		>
			<AlertDialogContent size="sm">
				<AlertDialogHeader>
					<AlertDialogMedia>
						<IconHistory />
					</AlertDialogMedia>
					<AlertDialogTitle>Restore this version?</AlertDialogTitle>
					<AlertDialogDescription>
						The document goes back to{' '}
						<span className="font-medium text-foreground">{versionTitle}</span> for everyone who has
						it open. What it has now is kept as a version, so you can come back to it.
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel disabled={isRestoreVersionPending}>Cancel</AlertDialogCancel>
					<AlertDialogAction
						disabled={isRestoreVersionPending || !versionId}
						onClick={() =>
							versionId &&
							handleRestoreVersion(
								{ documentId, versionId },
								{
									onSuccess: () => {
										onOpenChange(false);
										onRestored();
									},
								},
							)
						}
					>
						{isRestoreVersionPending && <IconLoader2 className="animate-spin" />}
						Restore
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
};
