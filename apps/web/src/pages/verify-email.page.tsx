import { IconCircleCheck } from '@tabler/icons-react';
import { Link, useSearchParams } from 'react-router';

import { ResendVerificationForm } from '@/components/forms/resend-verification.form';
import { buttonVariants } from '@/components/ui/button';
import { Field, FieldGroup } from '@/components/ui/field';
import { useSession } from '@/hooks/use-session.hook';

const VERIFY_EMAIL_ERRORS: Record<string, string> = {
	TOKEN_EXPIRED: 'This verification link has expired. Enter your email to get a new one.',
	INVALID_TOKEN: 'This verification link is invalid. Enter your email to get a new one.',
};

const DEFAULT_VERIFY_EMAIL_ERROR =
	'Something went wrong with this link. Enter your email to get a new one.';

export const VerifyEmailPage = () => {
	const [searchParams] = useSearchParams();
	const session = useSession();
	const error = searchParams.get('error');

	if (error) {
		return (
			<ResendVerificationForm reason={VERIFY_EMAIL_ERRORS[error] ?? DEFAULT_VERIFY_EMAIL_ERROR} />
		);
	}

	return (
		<FieldGroup>
			<div className="flex flex-col items-center gap-2 text-center">
				<div className="mb-2 flex size-10 items-center justify-center rounded-lg bg-muted">
					<IconCircleCheck className="size-5" />
				</div>
				<h1 className="text-2xl font-bold">Email verified</h1>
				<p className="text-sm text-balance text-muted-foreground">
					{session ? 'Your account is ready.' : 'Your account is ready. Sign in to continue.'}
				</p>
			</div>
			<Field>
				<Link to={session ? '/' : '/sign-in'} className={buttonVariants()}>
					{session ? 'Go to my documents' : 'Sign in'}
				</Link>
			</Field>
		</FieldGroup>
	);
};
