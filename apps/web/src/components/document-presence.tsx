import type { Awareness } from 'y-protocols/awareness';

import { Avatar, AvatarFallback, AvatarGroup, AvatarGroupCount } from '@/components/ui/avatar';
import { usePresence } from '@/hooks/use-presence.hook';
import { useAuthenticatedSession } from '@/hooks/use-session.hook';
import { getInitials } from '@/lib/user.lib';

const MAX_AVATARS = 4;

/** The other people in the document, with the same color as their cursor. */
export const DocumentPresence = ({ awareness }: { awareness: Awareness }) => {
	const { user } = useAuthenticatedSession();
	const people = usePresence(awareness, user.id);

	if (people.length === 0) return null;

	const shown = people.slice(0, MAX_AVATARS);
	const hidden = people.slice(MAX_AVATARS);

	return (
		<AvatarGroup
			role="group"
			aria-label={`People in this document: ${people.map((person) => person.name).join(', ')}`}
			className="mr-2 max-sm:hidden"
		>
			{shown.map((person) => (
				<Avatar key={person.id} size="sm" title={person.name}>
					<AvatarFallback className="text-white" style={{ backgroundColor: person.color }}>
						{getInitials(person.name)}
					</AvatarFallback>
				</Avatar>
			))}
			{hidden.length > 0 && (
				<AvatarGroupCount title={hidden.map((person) => person.name).join(', ')}>
					+{hidden.length}
				</AvatarGroupCount>
			)}
		</AvatarGroup>
	);
};
