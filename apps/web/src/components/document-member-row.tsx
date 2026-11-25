import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import type { DocumentMemberDetails } from '@/hooks/use-document-members.hook';
import { ROLE_LABELS } from '@/lib/document-role.lib';
import { getInitials } from '@/lib/user.lib';

interface DocumentMemberRowProps {
	member: DocumentMemberDetails;
	isCurrentUser: boolean;
}

export const DocumentMemberRow = ({ member, isCurrentUser }: DocumentMemberRowProps) => (
	<li className="flex items-center gap-3 py-2">
		<Avatar>
			{member.image && <AvatarImage src={member.image} alt={member.name} />}
			<AvatarFallback>{getInitials(member.name)}</AvatarFallback>
		</Avatar>

		<div className="flex min-w-0 flex-1 flex-col">
			<span className="truncate text-sm font-medium">
				{member.name}
				{isCurrentUser && <span className="font-normal text-muted-foreground"> (you)</span>}
			</span>
			<span className="truncate text-xs text-muted-foreground">{member.email}</span>
		</div>

		<span className="shrink-0 text-sm text-muted-foreground">{ROLE_LABELS[member.role]}</span>
	</li>
);
