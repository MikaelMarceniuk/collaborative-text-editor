import { IconDots, IconFileText, IconShare, IconTrash } from '@tabler/icons-react';
import type { SyntheticEvent } from 'react';
import { useNavigate } from 'react-router';

import { Button } from '@/components/ui/button';
import { CommandItem } from '@/components/ui/command';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { DocumentRole, DocumentSummary } from '@/hooks/use-documents.hook';
import { useAuthenticatedSession } from '@/hooks/use-session.hook';
import { formatRelativeTime } from '@/lib/date.lib';

const ROLE_LABELS: Record<DocumentRole, string> = {
	owner: 'Owner',
	editor: 'Can edit',
	viewer: 'View only',
};

// React events bubble through portals, so without this a click or key press inside the menu
// would also select the item (opening the document) or move the list selection.
const stopPropagation = (event: SyntheticEvent) => event.stopPropagation();

interface DocumentItemProps {
	document: DocumentSummary;
	onDelete: (document: DocumentSummary) => void;
}

export const DocumentItem = ({ document, onDelete }: DocumentItemProps) => {
	const { user } = useAuthenticatedSession();
	const navigate = useNavigate();

	const isMine = document.ownerId === user.id;
	const role = document.members.find((member) => member.userId === user.id)?.role;

	return (
		<CommandItem value={document._id} onSelect={() => navigate(`/${document._id}`)}>
			<IconFileText className="text-muted-foreground" />
			<span className="min-w-0 flex-1 truncate">{document.title}</span>
			{!isMine && (
				<span className="shrink-0 rounded-md border px-1.5 py-0.5 text-xs text-muted-foreground">
					Shared{role ? ` · ${ROLE_LABELS[role]}` : ''}
				</span>
			)}
			<span className="shrink-0 text-xs text-muted-foreground">
				{formatRelativeTime(document.updatedAt)}
			</span>

			<div className="flex" onClick={stopPropagation} onKeyDown={stopPropagation}>
				<DropdownMenu>
					<DropdownMenuTrigger
						render={
							<Button
								variant="ghost"
								size="icon-xs"
								aria-label={`Actions for ${document.title}`}
								className="opacity-0 group-hover/command-item:opacity-100 group-data-selected/command-item:opacity-100 focus-visible:opacity-100 data-popup-open:opacity-100 pointer-coarse:opacity-100"
							/>
						}
					>
						<IconDots />
					</DropdownMenuTrigger>

					<DropdownMenuContent align="end" className="w-40">
						<DropdownMenuItem disabled>
							<IconShare />
							Share
						</DropdownMenuItem>

						<DropdownMenuSeparator />

						<DropdownMenuItem
							variant="destructive"
							disabled={!isMine}
							onClick={() => onDelete(document)}
						>
							<IconTrash />
							Delete
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			</div>
		</CommandItem>
	);
};
