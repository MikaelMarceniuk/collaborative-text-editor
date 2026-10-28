import { IconMailX } from '@tabler/icons-react';
import { cn } from 'cn';
import { useState } from 'react';

import { CheckEmail } from '@/components/check-email';
import { Button } from '@/components/ui/button';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useResendVerificationEmail } from '@/hooks/use-resend-verification-email.hook';

interface ResendVerificationFormProps extends React.ComponentProps<'form'> {
	reason: string;
}

export const ResendVerificationForm: React.FC<ResendVerificationFormProps> = ({
	reason,
	className,
	...props
}) => {
	const { handleResend, isResendPending } = useResendVerificationEmail();
	const [sentTo, setSentTo] = useState<string | null>(null);

	if (sentTo) {
		return (
			<CheckEmail email={sentTo} backLabel="Use a different email" onBack={() => setSentTo(null)} />
		);
	}

	const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
		event.preventDefault();

		const email = String(new FormData(event.currentTarget).get('email')).trim();
		handleResend(email, () => setSentTo(email));
	};

	return (
		<form className={cn('flex flex-col gap-6', className)} onSubmit={handleSubmit} {...props}>
			<FieldGroup>
				<div className="flex flex-col items-center gap-2 text-center">
					<div className="mb-2 flex size-10 items-center justify-center rounded-lg bg-muted">
						<IconMailX className="size-5" />
					</div>
					<h1 className="text-2xl font-bold">Couldn&apos;t verify your email</h1>
					<p className="text-sm text-balance text-muted-foreground">{reason}</p>
				</div>
				<Field>
					<FieldLabel htmlFor="email">Email</FieldLabel>
					<Input
						id="email"
						name="email"
						type="email"
						autoComplete="email"
						placeholder="m@example.com"
						required
					/>
				</Field>
				<Field>
					<Button type="submit" disabled={isResendPending}>
						Send a new link
					</Button>
				</Field>
			</FieldGroup>
		</form>
	);
};
