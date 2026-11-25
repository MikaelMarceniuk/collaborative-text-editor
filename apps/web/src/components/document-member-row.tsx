import { IconLoader2, IconX } from '@tabler/icons-react';

import { type AssignableRole, MemberRoleSelect } from '@/components/member-role-select';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import type { DocumentMemberDetails } from '@/hooks/use-document-members.hook';
import { useRemoveMember } from '@/hooks/use-remove-member.hook';
import { useUpdateMemberRole } from '@/hooks/use-update-member-role.hook';
import { ROLE_LABELS } from '@/lib/document-role.lib';
import { getInitials } from '@/lib/user.lib';

interface DocumentMemberRowProps {
	documentId: string;
	member: DocumentMemberDetails;
	isCurrentUser: boolean;
	// Only the owner manages members, and never the owner's own row
	canManage: boolean;
}

export const DocumentMemberRow = ({
	documentId,
	member,
	isCurrentUser,
	canManage,
}: DocumentMemberRowProps) => {
	const { handleUpdateMemberRole, isUpdateMemberRolePending } = useUpdateMemberRole();
	const { handleRemoveMember, isRemoveMemberPending } = useRemoveMember();

	const isManageable = canManage && member.role !== 'owner';

	return (
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

			{isManageable ? (
				<>
					<MemberRoleSelect
						value={member.role as AssignableRole}
						disabled={isUpdateMemberRolePending || isRemoveMemberPending}
						aria-label={`Role of ${member.name}`}
						onValueChange={(role) =>
							role !== member.role &&
							handleUpdateMemberRole({ documentId, userId: member.userId, role })
						}
					/>
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label={`Remove ${member.name}`}
						title={`Remove ${member.name}`}
						disabled={isRemoveMemberPending}
						onClick={() =>
							handleRemoveMember({ documentId, userId: member.userId, name: member.name })
						}
					>
						{isRemoveMemberPending ? <IconLoader2 className="animate-spin" /> : <IconX />}
					</Button>
				</>
			) : (
				<span className="shrink-0 text-sm text-muted-foreground">{ROLE_LABELS[member.role]}</span>
			)}
		</li>
	);
};
