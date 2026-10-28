import { Link } from 'react-router';

import { AppAvatar } from '@/components/app-avatar';
import { DocumentList } from '@/components/document-list';
import { GuestNotice } from '@/components/guest-notice';
import { ThemeToggle } from '@/components/theme-toggle';
import { buttonVariants } from '@/components/ui/button';
import {
	Card,
	CardAction,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from '@/components/ui/card';
import { useDocuments } from '@/hooks/use-documents.hook';
import { useAuthenticatedSession } from '@/hooks/use-session.hook';

export const RootPage = () => {
	const { user } = useAuthenticatedSession();
	const { documents, isDocumentsPending, isDocumentsError, refetchDocuments } = useDocuments();

	return (
		<div className="flex min-h-svh items-center justify-center p-6 md:p-10">
			<Card className="w-full max-w-xl">
				<CardHeader>
					<CardTitle className="flex items-center gap-2 text-xl font-bold">
						Welcome{user.name ? `, ${user.name}` : ''}
						{user.isAnonymous && (
							<span className="rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
								Guest
							</span>
						)}
					</CardTitle>
					<CardDescription>Pick up where you left off.</CardDescription>
					<CardAction className="flex items-center gap-2">
						<ThemeToggle />
						<AppAvatar />
					</CardAction>
				</CardHeader>

				<CardContent className="flex flex-col gap-4">
					{user.isAnonymous && (
						<GuestNotice
							action={
								<Link
									to="/sign-up"
									className={buttonVariants({ size: 'sm', className: 'shrink-0' })}
								>
									Create account
								</Link>
							}
						>
							You&apos;re using a guest account. Create an account to keep your documents.
						</GuestNotice>
					)}
					<DocumentList
						documents={documents}
						isPending={isDocumentsPending}
						isError={isDocumentsError}
						onRetry={refetchDocuments}
					/>
				</CardContent>
			</Card>
		</div>
	);
};
