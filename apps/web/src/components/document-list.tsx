import {
	IconAlertTriangle,
	IconFiles,
	IconLoader2,
	IconPlus,
	IconRefresh,
	IconSearch,
	IconUsers,
} from '@tabler/icons-react';
import { type ReactNode, useState } from 'react';

import { DeleteDocumentDialog } from '@/components/delete-document-dialog';
import { DocumentItem } from '@/components/document-item';
import { RenameDocumentDialog } from '@/components/rename-document-dialog';
import { Button } from '@/components/ui/button';
import { Command, CommandInput, CommandList } from '@/components/ui/command';
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from '@/components/ui/empty';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useCreateDocument } from '@/hooks/use-create-document.hook';
import type { DocumentSummary } from '@/hooks/use-documents.hook';
import { useAuthenticatedSession } from '@/hooks/use-session.hook';

type DocumentFilter = 'all' | 'mine' | 'shared';

const SKELETON_ROWS = 6;

const Kbd = ({ children }: { children: ReactNode }) => (
	<kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border bg-muted px-1 font-sans text-[0.7rem] text-muted-foreground">
		{children}
	</kbd>
);

const DocumentListSkeleton = () => (
	<div aria-hidden className="flex flex-col gap-1 p-1">
		{Array.from({ length: SKELETON_ROWS }, (_, index) => (
			<div key={index} className="flex items-center gap-2 px-2 py-2">
				<Skeleton className="size-4" />
				<Skeleton className="h-4 flex-1" />
				<Skeleton className="h-3 w-16" />
			</div>
		))}
	</div>
);

interface DocumentListEmptyProps {
	icon: ReactNode;
	title: string;
	description: string;
	action?: ReactNode;
}

const DocumentListEmpty = ({ icon, title, description, action }: DocumentListEmptyProps) => (
	<Empty className="min-h-64">
		<EmptyHeader>
			<EmptyMedia variant="icon">{icon}</EmptyMedia>
			<EmptyTitle>{title}</EmptyTitle>
			<EmptyDescription>{description}</EmptyDescription>
		</EmptyHeader>
		{action && <EmptyContent>{action}</EmptyContent>}
	</Empty>
);

interface DocumentListProps {
	documents: DocumentSummary[];
	isPending: boolean;
	isError: boolean;
	onRetry: () => void;
}

export const DocumentList = ({ documents, isPending, isError, onRetry }: DocumentListProps) => {
	const { user } = useAuthenticatedSession();
	const { handleCreateDocument, isCreateDocumentPending } = useCreateDocument();
	const [search, setSearch] = useState('');
	const [filter, setFilter] = useState<DocumentFilter>('all');
	const [documentToRename, setDocumentToRename] = useState<DocumentSummary | null>(null);
	const [isRenameDialogOpen, setIsRenameDialogOpen] = useState(false);
	const [documentToDelete, setDocumentToDelete] = useState<DocumentSummary | null>(null);
	const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);

	const openRenameDialog = (document: DocumentSummary) => {
		setDocumentToRename(document);
		setIsRenameDialogOpen(true);
	};

	const openDeleteDialog = (document: DocumentSummary) => {
		setDocumentToDelete(document);
		setIsDeleteDialogOpen(true);
	};

	const myDocumentsCount = documents.filter((document) => document.ownerId === user.id).length;
	const counts: Record<DocumentFilter, number> = {
		all: documents.length,
		mine: myDocumentsCount,
		shared: documents.length - myDocumentsCount,
	};
	const formatCount = (filter: DocumentFilter) => (isPending ? '' : ` (${counts[filter]})`);

	// Filtered by hand (shouldFilter={false}) to keep the server's "most recently updated" order.
	const query = search.trim().toLowerCase();
	const visibleDocuments = documents.filter((document) => {
		const isMine = document.ownerId === user.id;
		if (filter === 'mine' && !isMine) return false;
		if (filter === 'shared' && isMine) return false;
		return document.title.toLowerCase().includes(query);
	});

	const createDocumentButton = (
		<Button size="sm" disabled={isCreateDocumentPending} onClick={handleCreateDocument}>
			{isCreateDocumentPending ? <IconLoader2 className="animate-spin" /> : <IconPlus />}
			New document
		</Button>
	);

	const renderContent = () => {
		if (isPending) {
			return <DocumentListSkeleton />;
		}

		if (isError) {
			return (
				<DocumentListEmpty
					icon={<IconAlertTriangle />}
					title="Couldn't load your documents"
					description="Something went wrong while fetching your documents."
					action={
						<Button size="sm" variant="outline" onClick={onRetry}>
							<IconRefresh />
							Try again
						</Button>
					}
				/>
			);
		}

		if (visibleDocuments.length === 0) {
			if (query) {
				return (
					<DocumentListEmpty
						icon={<IconSearch />}
						title="No results"
						description={`No documents match "${search.trim()}".`}
					/>
				);
			}

			if (filter === 'shared') {
				return (
					<DocumentListEmpty
						icon={<IconUsers />}
						title="Nothing shared with you yet"
						description="Documents other people share with you will show up here."
					/>
				);
			}

			return (
				<DocumentListEmpty
					icon={<IconFiles />}
					title="No documents yet"
					description="Create your first document to get started."
					action={createDocumentButton}
				/>
			);
		}

		return (
			<ScrollArea className="*:data-[slot=scroll-area-viewport]:max-h-80">
				<CommandList className="max-h-none overflow-visible">
					{visibleDocuments.map((document) => (
						<DocumentItem
							key={document._id}
							document={document}
							onRename={openRenameDialog}
							onDelete={openDeleteDialog}
						/>
					))}
				</CommandList>
			</ScrollArea>
		);
	};

	return (
		<>
			<Command shouldFilter={false} className="rounded-none! bg-transparent p-0">
				<CommandInput
					autoFocus
					placeholder="Search documents..."
					value={search}
					onValueChange={setSearch}
				/>

				<div className="flex items-center justify-between gap-2 px-1 pt-3 pb-2">
					<ToggleGroup
						size="sm"
						variant="outline"
						aria-label="Filter documents"
						value={[filter]}
						onValueChange={([value]) => value && setFilter(value as DocumentFilter)}
					>
						<ToggleGroupItem value="all">All{formatCount('all')}</ToggleGroupItem>
						<ToggleGroupItem value="mine">Mine{formatCount('mine')}</ToggleGroupItem>
						<ToggleGroupItem value="shared">Shared{formatCount('shared')}</ToggleGroupItem>
					</ToggleGroup>

					<Button size="sm" disabled={isCreateDocumentPending} onClick={handleCreateDocument}>
						{isCreateDocumentPending ? <IconLoader2 className="animate-spin" /> : <IconPlus />}
						New
					</Button>
				</div>

				<div className="min-h-64">{renderContent()}</div>

				<div className="flex items-center gap-3 border-t px-1 pt-3 text-xs text-muted-foreground">
					<span className="flex items-center gap-1">
						<Kbd>↑</Kbd>
						<Kbd>↓</Kbd>
						navigate
					</span>
					<span className="flex items-center gap-1">
						<Kbd>↵</Kbd>
						open
					</span>
				</div>
			</Command>

			<RenameDocumentDialog
				document={documentToRename}
				open={isRenameDialogOpen}
				onOpenChange={setIsRenameDialogOpen}
			/>

			<DeleteDocumentDialog
				document={documentToDelete}
				open={isDeleteDialogOpen}
				onOpenChange={setIsDeleteDialogOpen}
			/>
		</>
	);
};
