import { IconArrowLeft, IconMailCheck } from '@tabler/icons-react';

import { Button } from '@/components/ui/button';
import { Field, FieldGroup } from '@/components/ui/field';
import { useResendVerificationEmail } from '@/hooks/use-resend-verification-email.hook';
import { useIsGuest } from '@/hooks/use-session.hook';

interface CheckEmailProps {
	email: string;
	title?: string;
	description?: string;
	backLabel: string;
	onBack: () => void;
}

export const CheckEmail: React.FC<CheckEmailProps> = ({
	email,
	title = 'Check your email',
	description = 'We sent a verification link to',
	backLabel,
	onBack,
}) => {
	const isGuest = useIsGuest();
	const { handleResend, isResendPending, resendCooldown } = useResendVerificationEmail({
		justSent: true,
	});

	return (
		<FieldGroup>
			<div className="flex flex-col items-center gap-2 text-center">
				<div className="mb-2 flex size-10 items-center justify-center rounded-lg bg-muted">
					<IconMailCheck className="size-5" />
				</div>
				<h1 className="text-2xl font-bold">{title}</h1>
				<p className="text-sm text-balance text-muted-foreground">
					{description} <span className="font-medium break-all text-foreground">{email}</span>. The
					link expires in 1 hour.
				</p>
				{isGuest && (
					<p className="text-sm text-balance text-muted-foreground">
						Open the link in this browser to bring your guest documents along.
					</p>
				)}
			</div>
			<Field>
				<Button
					variant="outline"
					disabled={isResendPending || resendCooldown > 0}
					onClick={() => handleResend(email)}
				>
					{resendCooldown > 0 ? `Resend email in ${resendCooldown}s` : 'Resend email'}
				</Button>
				<Button variant="ghost" onClick={onBack}>
					<IconArrowLeft />
					{backLabel}
				</Button>
			</Field>
		</FieldGroup>
	);
};
