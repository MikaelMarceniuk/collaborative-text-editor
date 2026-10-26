import { useTransition } from 'react';
import { useNavigate } from 'react-router';

import { toast } from '@/components/ui/toast';
import { authClient } from '@/lib/auth-client.lib';

export const useContinueAsGuest = () => {
	const navigate = useNavigate();
	const [isGuestPending, startGuestTransition] = useTransition();

	const handleGuestSignIn = () => {
		startGuestTransition(async () => {
			const showError = (description?: string) =>
				toast.add({
					type: 'error',
					title: 'Could not continue as guest',
					description: description ?? 'Something went wrong. Please try again.',
				});

			let result: Awaited<ReturnType<typeof authClient.signIn.anonymous>>;
			try {
				result = await authClient.signIn.anonymous();
			} catch {
				showError('Could not reach the server. Please try again.');
				return;
			}

			if (result.error) {
				showError(result.error.message);
				return;
			}

			toast.add({
				type: 'success',
				title: 'Signed in as guest',
				description: "You're using a temporary account. Sign up anytime to keep your documents.",
			});

			navigate('/');
		});
	};

	return {
		handleGuestSignIn,
		isGuestPending,
	};
};
