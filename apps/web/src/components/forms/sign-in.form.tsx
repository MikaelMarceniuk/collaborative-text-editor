import { IconSpy } from '@tabler/icons-react';
import { cn } from 'cn';
import { Link } from 'react-router';

import { CheckEmail } from '@/components/check-email';
import { GuestUpgradeNotice } from '@/components/guest-upgrade-notice';
import { Button } from '@/components/ui/button';
import {
	Field,
	FieldDescription,
	FieldGroup,
	FieldLabel,
	FieldSeparator,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useContinueAsGuest } from '@/hooks/use-continue-as-guest.hook';
import { useIsGuest } from '@/hooks/use-session.hook';
import { useSignInEmail } from '@/hooks/use-sign-in-email.hook';

export const SignInForm: React.FC<React.ComponentProps<'form'>> = ({ className, ...props }) => {
	const isGuest = useIsGuest();
	const { handleGuestSignIn, isGuestPending } = useContinueAsGuest();
	const { handleSignIn, isSignInPending, unverifiedEmail, resetSignIn } = useSignInEmail();

	if (unverifiedEmail) {
		return (
			<CheckEmail
				email={unverifiedEmail}
				title="Verify your email"
				description="Your email isn't verified yet. We sent a new link to"
				backLabel="Back to sign in"
				onBack={resetSignIn}
			/>
		);
	}

	const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
		event.preventDefault();

		const formData = new FormData(event.currentTarget);
		handleSignIn({
			email: String(formData.get('email')).trim(),
			password: String(formData.get('password')),
		});
	};

	return (
		<form className={cn('flex flex-col gap-6', className)} onSubmit={handleSubmit} {...props}>
			<FieldGroup>
				<div className="flex flex-col items-center gap-1 text-center">
					<h1 className="text-2xl font-bold">Login to your account</h1>
					<p className="text-sm text-balance text-muted-foreground">
						Enter your email below to login to your account
					</p>
				</div>
				<GuestUpgradeNotice flow="sign-in" />
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
					<FieldLabel htmlFor="password">Password</FieldLabel>
					<Input
						id="password"
						name="password"
						type="password"
						autoComplete="current-password"
						required
					/>
				</Field>
				<Field>
					<Button type="submit" disabled={isSignInPending}>
						Login
					</Button>
				</Field>
				{/* A guest can't start another guest session (the server rejects it). */}
				{!isGuest && <FieldSeparator>Or continue with</FieldSeparator>}
				<Field>
					{!isGuest && (
						<Button
							variant="outline"
							type="button"
							disabled={isGuestPending}
							onClick={handleGuestSignIn}
						>
							<IconSpy />
							Continue as guest
						</Button>
					)}
					<FieldDescription className="text-center">
						Don&apos;t have an account? <Link to="/sign-up">Sign up</Link>
					</FieldDescription>
				</Field>
			</FieldGroup>
		</form>
	);
};
