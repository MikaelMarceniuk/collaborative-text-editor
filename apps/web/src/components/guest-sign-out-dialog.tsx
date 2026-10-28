import { IconLoader2, IconLogout } from '@tabler/icons-react';
import { useNavigate } from 'react-router';

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
import { Button } from '@/components/ui/button';
import { useDeleteGuest } from '@/hooks/use-delete-guest.hook';
import { formatGuestDocuments, useGuestDocumentCount } from '@/hooks/use-guest-document-count.hook';

interface GuestSignOutDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

const getDescription = (documentCount: number | null) => {
	if (documentCount === 0) return 'Your guest account will be deleted.';

	const keepWhat = documentCount === 1 ? 'it' : 'them';
	return `${formatGuestDocuments(documentCount)} will be permanently deleted. Create an account to keep ${keepWhat}.`;
};

export const GuestSignOutDialog = ({ open, onOpenChange }: GuestSignOutDialogProps) => {
	const navigate = useNavigate();
	const documentCount = useGuestDocumentCount();
	const { handleDeleteGuest, isDeleteGuestPending } = useDeleteGuest();

	const handleCreateAccount = () => {
		onOpenChange(false);
		void navigate('/sign-up');
	};

	return (
		<AlertDialog
			open={open}
			onOpenChange={(nextOpen) => !isDeleteGuestPending && onOpenChange(nextOpen)}
		>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogMedia className="bg-destructive/10 text-destructive">
						<IconLogout />
					</AlertDialogMedia>
					<AlertDialogTitle>Sign out of guest account?</AlertDialogTitle>
					<AlertDialogDescription>{getDescription(documentCount)}</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel disabled={isDeleteGuestPending}>Cancel</AlertDialogCancel>
					<Button variant="outline" disabled={isDeleteGuestPending} onClick={handleCreateAccount}>
						Create account
					</Button>
					<AlertDialogAction
						variant="destructive"
						disabled={isDeleteGuestPending}
						onClick={handleDeleteGuest}
					>
						{isDeleteGuestPending && <IconLoader2 className="animate-spin" />}
						Delete and sign out
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
};
