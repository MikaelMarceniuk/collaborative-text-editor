import { IconLogout, IconUser } from '@tabler/icons-react';

import { useAuthenticatedSession } from '@/hooks/use-session.hook';
import { useSignOut } from '@/hooks/use-sign-out.hook';

import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from './ui/dropdown-menu';

const getInitials = (name: string) =>
	name
		.split(' ')
		.filter(Boolean)
		.slice(0, 2)
		.map((part) => part[0]!.toUpperCase())
		.join('');

export const AppAvatar = () => {
	const { user } = useAuthenticatedSession();
	const { handleSignOut, isSignOutPending } = useSignOut();
	const initials = user.isAnonymous ? '' : getInitials(user.name);
	const displayName = user.isAnonymous ? 'Guest' : user.name;

	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				aria-label="Open account menu"
				className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
			>
				<Avatar size="sm">
					{user.image && <AvatarImage src={user.image} alt={user.name} />}
					<AvatarFallback>{initials || <IconUser className="size-3.5" />}</AvatarFallback>
				</Avatar>
			</DropdownMenuTrigger>

			<DropdownMenuContent align="end" className="w-56">
				<DropdownMenuGroup>
					<DropdownMenuLabel className="flex flex-col gap-0.5">
						<span className="truncate text-sm text-foreground">{displayName}</span>
						{!user.isAnonymous && <span className="truncate font-normal">{user.email}</span>}
					</DropdownMenuLabel>
				</DropdownMenuGroup>

				<DropdownMenuSeparator />

				<DropdownMenuItem variant="destructive" disabled={isSignOutPending} onClick={handleSignOut}>
					<IconLogout />
					Sign out
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
};
