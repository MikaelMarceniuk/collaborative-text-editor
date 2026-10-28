import { IconLoader2, IconTrash } from '@tabler/icons-react';

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
import { useDeleteDocument } from '@/hooks/use-delete-document.hook';
import type { DocumentSummary } from '@/hooks/use-documents.hook';

interface DeleteDocumentDialogProps {
	document: DocumentSummary | null;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

export const DeleteDocumentDialog = ({
	document,
	open,
	onOpenChange,
}: DeleteDocumentDialogProps) => {
	const { handleDeleteDocument, isDeleteDocumentPending } = useDeleteDocument();

	const handleConfirm = () => {
		if (!document) return;
		handleDeleteDocument(document._id, { onSuccess: () => onOpenChange(false) });
	};

	return (
		<AlertDialog
			open={open}
			onOpenChange={(nextOpen) => !isDeleteDocumentPending && onOpenChange(nextOpen)}
		>
			<AlertDialogContent size="sm">
				<AlertDialogHeader>
					<AlertDialogMedia className="bg-destructive/10 text-destructive">
						<IconTrash />
					</AlertDialogMedia>
					<AlertDialogTitle>Delete document?</AlertDialogTitle>
					<AlertDialogDescription>
						<span className="font-medium text-foreground">{document?.title}</span> will be
						permanently deleted for everyone with access. This can&apos;t be undone.
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel disabled={isDeleteDocumentPending}>Cancel</AlertDialogCancel>
					<AlertDialogAction
						variant="destructive"
						disabled={isDeleteDocumentPending}
						onClick={handleConfirm}
					>
						{isDeleteDocumentPending && <IconLoader2 className="animate-spin" />}
						Delete
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
};
