import { cn } from 'cn';
import { useState } from 'react';
import { Link } from 'react-router';

import { CheckEmail } from '@/components/check-email';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useSignUpEmail } from '@/hooks/use-sign-up-email.hook';

const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;

export const SignUpForm: React.FC<React.ComponentProps<'form'>> = ({ className, ...props }) => {
	const { handleSignUp, isSignUpPending, verificationSentTo, resetSignUp } = useSignUpEmail();
	const [isPasswordMismatch, setIsPasswordMismatch] = useState(false);

	if (verificationSentTo) {
		return (
			<CheckEmail
				email={verificationSentTo}
				backLabel="Use a different email"
				onBack={resetSignUp}
			/>
		);
	}

	const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
		event.preventDefault();

		const formData = new FormData(event.currentTarget);
		const password = String(formData.get('password'));

		if (password !== String(formData.get('confirmPassword'))) {
			setIsPasswordMismatch(true);
			return;
		}

		setIsPasswordMismatch(false);
		handleSignUp({
			name: String(formData.get('name')).trim(),
			email: String(formData.get('email')).trim(),
			password,
		});
	};

	return (
		<form className={cn('flex flex-col gap-6', className)} onSubmit={handleSubmit} {...props}>
			<FieldGroup>
				<div className="flex flex-col items-center gap-1 text-center">
					<h1 className="text-2xl font-bold">Create your account</h1>
					<p className="text-sm text-balance text-muted-foreground">
						We&apos;ll send you a link to verify your email
					</p>
				</div>
				<Field>
					<FieldLabel htmlFor="name">Name</FieldLabel>
					<Input id="name" name="name" autoComplete="name" required maxLength={100} />
				</Field>
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
						autoComplete="new-password"
						required
						minLength={MIN_PASSWORD_LENGTH}
						maxLength={MAX_PASSWORD_LENGTH}
					/>
					<FieldDescription>At least {MIN_PASSWORD_LENGTH} characters.</FieldDescription>
				</Field>
				<Field data-invalid={isPasswordMismatch}>
					<FieldLabel htmlFor="confirm-password">Confirm password</FieldLabel>
					<Input
						id="confirm-password"
						name="confirmPassword"
						type="password"
						autoComplete="new-password"
						required
						aria-invalid={isPasswordMismatch}
						onChange={() => setIsPasswordMismatch(false)}
					/>
					{isPasswordMismatch && <FieldError>Passwords don&apos;t match.</FieldError>}
				</Field>
				<Field>
					<Button type="submit" disabled={isSignUpPending}>
						Create account
					</Button>
					<FieldDescription className="text-center">
						Already have an account? <Link to="/sign-in">Sign in</Link>
					</FieldDescription>
				</Field>
			</FieldGroup>
		</form>
	);
};
