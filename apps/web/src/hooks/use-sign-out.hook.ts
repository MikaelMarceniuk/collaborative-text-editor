import { useTransition } from 'react';
import { useRevalidator } from 'react-router';

import { toast } from '@/components/ui/toast';
import { authClient } from '@/lib/auth-client.lib';

export const useSignOut = () => {
	const { revalidate } = useRevalidator();
	const [isSignOutPending, startSignOutTransition] = useTransition();

	const handleSignOut = () => {
		startSignOutTransition(async () => {
			const showError = (description?: string) =>
				toast.add({
					type: 'error',
					title: 'Could not sign out',
					description: description ?? 'Something went wrong. Please try again.',
				});

			let result: Awaited<ReturnType<typeof authClient.signOut>>;
			try {
				result = await authClient.signOut();
			} catch {
				showError('Could not reach the server. Please try again.');
				return;
			}

			if (result.error) {
				showError(result.error.message);
				return;
			}

			await revalidate();
		});
	};

	return {
		handleSignOut,
		isSignOutPending,
	};
};
