import { IconLoader2 } from '@tabler/icons-react';
import { type FormEvent, useState } from 'react';

import { type AssignableRole, MemberRoleSelect } from '@/components/member-role-select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAddMember } from '@/hooks/use-add-member.hook';

interface InviteMemberFormProps {
	documentId: string;
}

export const InviteMemberForm = ({ documentId }: InviteMemberFormProps) => {
	const { handleAddMember, isAddMemberPending, addMemberError, resetAddMemberError } =
		useAddMember();
	const [email, setEmail] = useState('');
	const [role, setRole] = useState<AssignableRole>('editor');

	const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();

		handleAddMember({ documentId, email: email.trim(), role }, { onSuccess: () => setEmail('') });
	};

	return (
		<form className="flex flex-col gap-2" onSubmit={handleSubmit}>
			<div className="flex flex-wrap items-center gap-2">
				<Input
					type="email"
					name="email"
					aria-label="Email of the person to invite"
					aria-invalid={Boolean(addMemberError)}
					placeholder="Add people by email"
					autoComplete="off"
					required
					value={email}
					onChange={(event) => {
						setEmail(event.target.value);
						if (addMemberError) resetAddMemberError();
					}}
					className="min-w-48 flex-1"
				/>
				<MemberRoleSelect
					value={role}
					onValueChange={setRole}
					disabled={isAddMemberPending}
					aria-label="Role of the person to invite"
				/>
				<Button type="submit" size="sm" disabled={isAddMemberPending || !email.trim()}>
					{isAddMemberPending && <IconLoader2 className="animate-spin" />}
					Invite
				</Button>
			</div>

			{addMemberError && (
				<p role="alert" className="text-sm text-destructive">
					{addMemberError}
				</p>
			)}
		</form>
	);
};
