import { IconDots, IconFileText, IconPencil, IconShare, IconTrash } from '@tabler/icons-react';
import type { SyntheticEvent } from 'react';
import { useNavigate } from 'react-router';

import { SearchSnippet } from '@/components/search-snippet';
import { Button } from '@/components/ui/button';
import { CommandItem } from '@/components/ui/command';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { canEditDocument, type DocumentSummary } from '@/hooks/use-documents.hook';
import type { SearchedDocument } from '@/hooks/use-search-documents.hook';
import { useAuthenticatedSession } from '@/hooks/use-session.hook';
import { formatRelativeTime } from '@/lib/date.lib';
import { ROLE_LABELS } from '@/lib/document-role.lib';

// React events bubble through portals, so without this a click or key press inside the menu
// would also select the item (opening the document) or move the list selection.
const stopPropagation = (event: SyntheticEvent) => event.stopPropagation();

interface DocumentItemProps {
	// A search result also has the piece of text where the words were found
	document: DocumentSummary | SearchedDocument;
	onRename: (document: DocumentSummary) => void;
	onShare: (document: DocumentSummary) => void;
	onDelete: (document: DocumentSummary) => void;
}

export const DocumentItem = ({ document, onRename, onShare, onDelete }: DocumentItemProps) => {
	const { user } = useAuthenticatedSession();
	const navigate = useNavigate();

	const isMine = document.ownerId === user.id;
	const role = document.members.find((member) => member.userId === user.id)?.role;

	return (
		<CommandItem value={document._id} onSelect={() => navigate(`/${document._id}`)}>
			<IconFileText className="text-muted-foreground" />
			<span className="flex min-w-0 flex-1 flex-col">
				<span className="truncate">{document.title}</span>
				{'snippet' in document && document.snippet && <SearchSnippet snippet={document.snippet} />}
			</span>
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
						<DropdownMenuItem disabled={!canEditDocument(role)} onClick={() => onRename(document)}>
							<IconPencil />
							Rename
						</DropdownMenuItem>
						<DropdownMenuItem onClick={() => onShare(document)}>
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
