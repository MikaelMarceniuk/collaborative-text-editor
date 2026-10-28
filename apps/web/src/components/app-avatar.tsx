import { IconLogin, IconLogout, IconUser, IconUserPlus } from '@tabler/icons-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';

import { useAuthenticatedSession } from '@/hooks/use-session.hook';
import { useSignOut } from '@/hooks/use-sign-out.hook';

import { GuestSignOutDialog } from './guest-sign-out-dialog';
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
	const navigate = useNavigate();
	const { handleSignOut, isSignOutPending } = useSignOut();
	const [isGuestSignOutOpen, setIsGuestSignOutOpen] = useState(false);
	const initials = user.isAnonymous ? '' : getInitials(user.name);
	const displayName = user.isAnonymous ? 'Guest' : user.name;

	return (
		<>
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

					{user.isAnonymous && (
						<>
							<DropdownMenuGroup>
								<DropdownMenuItem onClick={() => void navigate('/sign-up')}>
									<IconUserPlus />
									Create account
								</DropdownMenuItem>
								<DropdownMenuItem onClick={() => void navigate('/sign-in')}>
									<IconLogin />
									Sign in
								</DropdownMenuItem>
							</DropdownMenuGroup>

							<DropdownMenuSeparator />
						</>
					)}

					<DropdownMenuItem
						variant="destructive"
						disabled={isSignOutPending}
						onClick={user.isAnonymous ? () => setIsGuestSignOutOpen(true) : handleSignOut}
					>
						<IconLogout />
						Sign out
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>

			{user.isAnonymous && (
				<GuestSignOutDialog open={isGuestSignOutOpen} onOpenChange={setIsGuestSignOutOpen} />
			)}
		</>
	);
};
