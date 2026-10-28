import { useState, useTransition } from 'react';
import { useRevalidator } from 'react-router';

import { toast } from '@/components/ui/toast';
import { authClient, EMAIL_VERIFICATION_CALLBACK_URL } from '@/lib/auth-client.lib';

import { useIsGuest } from './use-session.hook';

export interface SignInEmailInput {
	email: string;
	password: string;
}

export const useSignInEmail = () => {
	const { revalidate } = useRevalidator();
	const isGuest = useIsGuest();
	const [isSignInPending, startSignInTransition] = useTransition();
	const [unverifiedEmail, setUnverifiedEmail] = useState<string | null>(null);

	const handleSignIn = (input: SignInEmailInput) => {
		const wasGuest = isGuest;

		startSignInTransition(async () => {
			const showError = (description?: string) =>
				toast.add({
					type: 'error',
					title: 'Could not sign in',
					description: description ?? 'Something went wrong. Please try again.',
				});

			let result: Awaited<ReturnType<typeof authClient.signIn.email>>;
			try {
				result = await authClient.signIn.email(input);
			} catch {
				showError('Could not reach the server. Please try again.');
				return;
			}

			if (result.error?.code === 'EMAIL_NOT_VERIFIED') {
				const resent = await authClient
					.sendVerificationEmail({
						email: input.email,
						callbackURL: EMAIL_VERIFICATION_CALLBACK_URL,
					})
					.catch(() => null);

				if (!resent || resent.error) {
					showError(
						"Your email isn't verified yet, and we could not send a new link. Please try again.",
					);
					return;
				}

				setUnverifiedEmail(input.email);
				return;
			}

			if (result.error) {
				showError(result.error.message);
				return;
			}

			if (wasGuest) {
				toast.add({
					type: 'success',
					title: 'Signed in',
					description: 'Your guest documents were added to your account.',
				});
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
