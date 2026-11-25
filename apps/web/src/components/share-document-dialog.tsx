import { IconAlertTriangle, IconDoorExit, IconRefresh, IconUserPlus } from '@tabler/icons-react';
import { useState } from 'react';
import { Link } from 'react-router';

import { DocumentMemberRow } from '@/components/document-member-row';
import { InviteMemberForm } from '@/components/invite-member-form';
import { LeaveDocumentDialog } from '@/components/leave-document-dialog';
import { Button, buttonVariants } from '@/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { useDocumentMembers } from '@/hooks/use-document-members.hook';
import type { DocumentSummary } from '@/hooks/use-documents.hook';
import { useAuthenticatedSession, useIsGuest } from '@/hooks/use-session.hook';

const SKELETON_ROWS = 3;

// Guests have no email, and their documents are deleted if the guest is abandoned,
// so the server does not let them share. Here they are pointed to an account instead.
const GuestSharePrompt = () => (
	<div className="flex flex-col items-center gap-3 py-4 text-center">
		<span className="flex size-10 items-center justify-center rounded-lg bg-muted">
			<IconUserPlus className="size-5" />
		</span>
		<div className="flex flex-col gap-1">
			<p className="text-sm font-medium">Create an account to share documents</p>
			<p className="text-sm text-balance text-muted-foreground">
				Guest accounts can&apos;t share documents. Your documents will move to your new account.
			</p>
		</div>
		<div className="flex gap-2">
			<Link to="/sign-up" className={buttonVariants({ size: 'sm' })}>
				Create account
			</Link>
			<Link to="/sign-in" className={buttonVariants({ size: 'sm', variant: 'outline' })}>
				Sign in
			</Link>
		</div>
	</div>
);

const MembersSkeleton = () => (
	<div aria-hidden className="flex flex-col gap-3 py-2">
		{Array.from({ length: SKELETON_ROWS }, (_, index) => (
			<div key={index} className="flex items-center gap-3">
				<Skeleton className="size-8 rounded-full" />
				<div className="flex flex-1 flex-col gap-1.5">
					<Skeleton className="h-3.5 w-32" />
					<Skeleton className="h-3 w-48" />
				</div>
			</div>
		))}
	</div>
);

interface ShareDocumentDialogProps {
	document: DocumentSummary | null;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

export const ShareDocumentDialog = ({ document, open, onOpenChange }: ShareDocumentDialogProps) => {
	const { user } = useAuthenticatedSession();
	const isGuest = useIsGuest();
	const { members, isMembersPending, isMembersError, refetchMembers } = useDocumentMembers(
		document?._id,
		{ enabled: open && !isGuest },
	);

	const [isLeaveDialogOpen, setIsLeaveDialogOpen] = useState(false);
	const isOwner = document?.ownerId === user.id;

	const renderMembers = () => {
		if (isMembersPending) {
			return <MembersSkeleton />;
		}

		if (isMembersError) {
			return (
				<div className="flex flex-col items-center gap-3 py-6 text-center text-sm text-muted-foreground">
					<IconAlertTriangle className="size-5" />
					Couldn&apos;t load the people with access.
					<Button size="sm" variant="outline" onClick={() => void refetchMembers()}>
						<IconRefresh />
						Try again
					</Button>
				</div>
			);
		}

		return (
			<ul className="flex flex-col divide-y">
				{members.map((member) => (
					<DocumentMemberRow
						key={member.userId}
						documentId={document!._id}
						member={member}
						isCurrentUser={member.userId === user.id}
						canManage={isOwner}
					/>
				))}
			</ul>
		);
	};

	return (
		<>
			<Dialog open={open} onOpenChange={onOpenChange}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Share document</DialogTitle>
						<DialogDescription className="truncate">{document?.title}</DialogDescription>
					</DialogHeader>

					{isGuest ? (
						<GuestSharePrompt />
					) : (
						<>
							{isOwner && document && <InviteMemberForm documentId={document._id} />}

							<section aria-label="People with access" className="flex flex-col gap-1">
								<h3 className="text-sm font-medium">People with access</h3>
								{renderMembers()}
							</section>

							{!isOwner && (
								<DialogFooter>
									<Button variant="outline" onClick={() => setIsLeaveDialogOpen(true)}>
										<IconDoorExit />
										Leave document
									</Button>
								</DialogFooter>
							)}
						</>
					)}
				</DialogContent>
			</Dialog>

			<LeaveDocumentDialog
				document={document}
				open={isLeaveDialogOpen}
				onOpenChange={setIsLeaveDialogOpen}
			/>
		</>
	);
};
