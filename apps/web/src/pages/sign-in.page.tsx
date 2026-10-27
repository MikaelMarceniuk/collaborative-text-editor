import { IconKeyframeAlignVertical } from '@tabler/icons-react';

import placeholderImg from '@/assets/placeholder.svg';
import { SignInForm } from '@/components/forms/sign-in.form';
import { ThemeToggle } from '@/components/theme-toggle';

export const SignInPage = () => {
	return (
		<div className="grid min-h-svh lg:grid-cols-2">
			<div className="flex flex-col gap-4 p-6 md:p-10">
				<div className="flex items-center justify-between gap-2">
					<a href="#" className="flex items-center gap-2 font-medium">
						<div className="flex size-6 items-center justify-center rounded-md bg-primary text-primary-foreground">
							<IconKeyframeAlignVertical className="size-4" />
						</div>
						Acme Inc.
					</a>
					<ThemeToggle />
				</div>
				<div className="flex flex-1 items-center justify-center">
					<div className="w-full max-w-xs">
						<SignInForm />
					</div>
				</div>
			</div>
			<div className="relative hidden bg-muted lg:block">
				<img
					src={placeholderImg}
					alt="Image"
					className="absolute inset-0 h-full w-full object-cover dark:brightness-[0.2] dark:grayscale"
				/>
			</div>
		</div>
	);
};
