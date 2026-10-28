import { useState, useTransition } from 'react';

import { toast } from '@/components/ui/toast';
import { authClient, EMAIL_VERIFICATION_CALLBACK_URL } from '@/lib/auth-client.lib';

export interface SignUpEmailInput {
	name: string;
	email: string;
	password: string;
}

export const useSignUpEmail = () => {
	const [isSignUpPending, startSignUpTransition] = useTransition();
	const [verificationSentTo, setVerificationSentTo] = useState<string | null>(null);

	const handleSignUp = (input: SignUpEmailInput) => {
		startSignUpTransition(async () => {
			const showError = (description?: string) =>
				toast.add({
					type: 'error',
					title: 'Could not create your account',
					description: description ?? 'Something went wrong. Please try again.',
				});

			let result: Awaited<ReturnType<typeof authClient.signUp.email>>;
			try {
				result = await authClient.signUp.email({
					...input,
					callbackURL: EMAIL_VERIFICATION_CALLBACK_URL,
				});
			} catch {
				showError('Could not reach the server. Please try again.');
				return;
			}

			if (result.error) {
				showError(result.error.message);
				return;
			}

			setVerificationSentTo(input.email);
		});
	};

	return {
		handleSignUp,
		isSignUpPending,
		verificationSentTo,
		resetSignUp: () => setVerificationSentTo(null),
	};
};
