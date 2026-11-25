import { IconAlertTriangle, IconRefresh } from '@tabler/icons-react';

import { DocumentMemberRow } from '@/components/document-member-row';
import { Button } from '@/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { useDocumentMembers } from '@/hooks/use-document-members.hook';
import type { DocumentSummary } from '@/hooks/use-documents.hook';
import { useAuthenticatedSession } from '@/hooks/use-session.hook';

const SKELETON_ROWS = 3;

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
	const { members, isMembersPending, isMembersError, refetchMembers } = useDocumentMembers(
		document?._id,
		{ enabled: open },
	);

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
						member={member}
						isCurrentUser={member.userId === user.id}
					/>
				))}
			</ul>
		);
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Share document</DialogTitle>
					<DialogDescription className="truncate">{document?.title}</DialogDescription>
				</DialogHeader>

				<section aria-label="People with access" className="flex flex-col gap-1">
					<h3 className="text-sm font-medium">People with access</h3>
					{renderMembers()}
				</section>
			</DialogContent>
		</Dialog>
	);
};
