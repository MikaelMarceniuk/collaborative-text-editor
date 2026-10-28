import { useTransition } from 'react';
import { useRevalidator } from 'react-router';

import { toast } from '@/components/ui/toast';
import { authClient } from '@/lib/auth-client.lib';

export const useDeleteGuest = () => {
	const { revalidate } = useRevalidator();
	const [isDeleteGuestPending, startDeleteGuestTransition] = useTransition();

	const handleDeleteGuest = () => {
		startDeleteGuestTransition(async () => {
			const showError = (description?: string) =>
				toast.add({
					type: 'error',
					title: 'Could not sign out',
					description: description ?? 'Something went wrong. Please try again.',
				});

			let result: Awaited<ReturnType<typeof authClient.deleteAnonymousUser>>;
			try {
				result = await authClient.deleteAnonymousUser();
			} catch {
				showError('Could not reach the server. Please try again.');
				return;
			}

			if (result.error) {
				showError(result.error.message);
				return;
			}

			toast.add({ type: 'success', title: 'Guest account deleted' });

			await revalidate();
		});
	};

	return {
		handleDeleteGuest,
		isDeleteGuestPending,
	};
};
