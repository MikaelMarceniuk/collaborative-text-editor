import type { Awareness } from 'y-protocols/awareness';

import { Avatar, AvatarFallback, AvatarGroup, AvatarGroupCount } from '@/components/ui/avatar';
import { usePresence } from '@/hooks/use-presence.hook';
import { useAuthenticatedSession } from '@/hooks/use-session.hook';
import { getInitials } from '@/lib/user.lib';

// The header is tight on a phone, so there fewer avatars fit. Both counts are rendered and CSS picks one
const MAX_AVATARS = 4;
const MAX_AVATARS_SMALL = 2;

/** The other people in the document, with the same color as their cursor. */
export const DocumentPresence = ({ awareness }: { awareness: Awareness }) => {
	const { user } = useAuthenticatedSession();
	const people = usePresence(awareness, user.id);

	if (people.length === 0) return null;

	const namesOf = (list: typeof people) => list.map((person) => person.name).join(', ');
	const hiddenLarge = people.slice(MAX_AVATARS);
	const hiddenSmall = people.slice(MAX_AVATARS_SMALL);

	return (
		<AvatarGroup
			role="group"
			aria-label={`People in this document: ${namesOf(people)}`}
			className="mr-1 shrink-0 sm:mr-2"
		>
			{people.slice(0, MAX_AVATARS).map((person, index) => (
				<Avatar
					key={person.id}
					size="sm"
					title={person.name}
					className={index >= MAX_AVATARS_SMALL ? 'max-sm:hidden' : undefined}
				>
					<AvatarFallback className="text-white" style={{ backgroundColor: person.color }}>
						{getInitials(person.name)}
					</AvatarFallback>
				</Avatar>
			))}
			{hiddenSmall.length > 0 && (
				<AvatarGroupCount title={namesOf(hiddenSmall)} className="sm:hidden">
					+{hiddenSmall.length}
				</AvatarGroupCount>
			)}
			{hiddenLarge.length > 0 && (
				<AvatarGroupCount title={namesOf(hiddenLarge)} className="max-sm:hidden">
					+{hiddenLarge.length}
				</AvatarGroupCount>
			)}
		</AvatarGroup>
	);
};
