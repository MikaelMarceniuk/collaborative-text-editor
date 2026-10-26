import { IconSpy } from '@tabler/icons-react';
import { cn } from 'cn';

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

export const SignInForm: React.FC<React.ComponentProps<'form'>> = ({ className, ...props }) => {
	const { handleGuestSignIn, isGuestPending } = useContinueAsGuest();

	return (
		<form className={cn('flex flex-col gap-6', className)} {...props}>
			<FieldGroup>
				<div className="flex flex-col items-center gap-1 text-center">
					<h1 className="text-2xl font-bold">Login to your account</h1>
					<p className="text-sm text-balance text-muted-foreground">
						Enter your email below to login to your account
					</p>
				</div>
				<Field>
					<FieldLabel htmlFor="email">Email</FieldLabel>
					<Input id="email" type="email" placeholder="m@example.com" required />
				</Field>
				<Field>
					<div className="flex items-center">
						<FieldLabel htmlFor="password">Password</FieldLabel>
						<a href="#" className="ml-auto text-sm underline-offset-4 hover:underline">
							Forgot your password?
						</a>
					</div>
					<Input id="password" type="password" required />
				</Field>
				<Field>
					<Button type="submit">Login</Button>
				</Field>
				<FieldSeparator>Or continue with</FieldSeparator>
				<Field>
					<Button
						variant="outline"
						type="button"
						disabled={isGuestPending}
						onClick={handleGuestSignIn}
					>
						<IconSpy />
						Continue as guest
					</Button>
					<FieldDescription className="text-center">
						Don&apos;t have an account?{' '}
						<a href="#" className="underline underline-offset-4">
							Sign up
						</a>
					</FieldDescription>
				</Field>
			</FieldGroup>
		</form>
	);
};
