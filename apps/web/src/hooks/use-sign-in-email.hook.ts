import { useState, useTransition } from 'react';
import { useRevalidator } from 'react-router';

import { toast } from '@/components/ui/toast';
import { authClient, EMAIL_VERIFICATION_CALLBACK_URL } from '@/lib/auth-client.lib';

export interface SignInEmailInput {
	email: string;
	password: string;
}

export const useSignInEmail = () => {
	const { revalidate } = useRevalidator();
	const [isSignInPending, startSignInTransition] = useTransition();
	const [unverifiedEmail, setUnverifiedEmail] = useState<string | null>(null);

	const handleSignIn = (input: SignInEmailInput) => {
		startSignInTransition(async () => {
			const showError = (description?: string) =>
				toast.add({
					type: 'error',
					title: 'Could not sign in',
					description: description ?? 'Something went wrong. Please try again.',
				});

			let result: Awaited<ReturnType<typeof authClient.signIn.email>>;
			try {
				// The callback URL is only used by the link the server resends to unverified users.
				result = await authClient.signIn.email({
					...input,
					callbackURL: EMAIL_VERIFICATION_CALLBACK_URL,
				});
			} catch {
				showError('Could not reach the server. Please try again.');
				return;
			}

			if (result.error?.code === 'EMAIL_NOT_VERIFIED') {
				setUnverifiedEmail(input.email);
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
		handleSignIn,
		isSignInPending,
		unverifiedEmail,
		resetSignIn: () => setUnverifiedEmail(null),
	};
};
