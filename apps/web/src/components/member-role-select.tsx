import { IconChevronDown } from '@tabler/icons-react';

import { Button } from '@/components/ui/button';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { DocumentRole } from '@/hooks/use-documents.hook';
import { ROLE_LABELS } from '@/lib/document-role.lib';

export type AssignableRole = Exclude<DocumentRole, 'owner'>;

const ASSIGNABLE_ROLES: AssignableRole[] = ['editor', 'viewer'];

interface MemberRoleSelectProps {
	value: AssignableRole;
	onValueChange: (role: AssignableRole) => void;
	disabled?: boolean;
	'aria-label': string;
}

// The owner role is never assigned: a document has a single owner, set when it is created
export const MemberRoleSelect = ({
	value,
	onValueChange,
	disabled,
	'aria-label': ariaLabel,
}: MemberRoleSelectProps) => (
	<DropdownMenu>
		<DropdownMenuTrigger
			render={<Button variant="outline" size="sm" disabled={disabled} aria-label={ariaLabel} />}
		>
			{ROLE_LABELS[value]}
			<IconChevronDown />
		</DropdownMenuTrigger>

		<DropdownMenuContent align="end" className="w-36">
			<DropdownMenuRadioGroup
				value={value}
				onValueChange={(role) => onValueChange(role as AssignableRole)}
			>
				{ASSIGNABLE_ROLES.map((role) => (
					<DropdownMenuRadioItem key={role} value={role}>
						{ROLE_LABELS[role]}
					</DropdownMenuRadioItem>
				))}
			</DropdownMenuRadioGroup>
		</DropdownMenuContent>
	</DropdownMenu>
);
