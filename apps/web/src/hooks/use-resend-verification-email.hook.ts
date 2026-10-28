import { useEffect, useState, useTransition } from 'react';

import { toast } from '@/components/ui/toast';
import { authClient, EMAIL_VERIFICATION_CALLBACK_URL } from '@/lib/auth-client.lib';

const RESEND_COOLDOWN_SECONDS = 60;

interface UseResendVerificationEmailOptions {
	justSent?: boolean;
}

export const useResendVerificationEmail = ({
	justSent = false,
}: UseResendVerificationEmailOptions = {}) => {
	const [isResendPending, startResendTransition] = useTransition();
	const [cooldown, setCooldown] = useState(justSent ? RESEND_COOLDOWN_SECONDS : 0);

	useEffect(() => {
		if (cooldown <= 0) return;

		const timeout = setTimeout(() => setCooldown((seconds) => seconds - 1), 1000);
		return () => clearTimeout(timeout);
	}, [cooldown]);

	const handleResend = (email: string, onSent?: () => void) => {
		startResendTransition(async () => {
			const showError = (description?: string) =>
				toast.add({
					type: 'error',
					title: 'Could not send the email',
					description: description ?? 'Something went wrong. Please try again.',
				});

			let result: Awaited<ReturnType<typeof authClient.sendVerificationEmail>>;
			try {
				result = await authClient.sendVerificationEmail({
					email,
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

			toast.add({
				type: 'success',
				title: 'Verification email sent',
				description: `Check the inbox of ${email}.`,
			});

			setCooldown(RESEND_COOLDOWN_SECONDS);
			onSent?.();
		});
	};

	return {
		handleResend,
		isResendPending,
		resendCooldown: cooldown,
	};
};
