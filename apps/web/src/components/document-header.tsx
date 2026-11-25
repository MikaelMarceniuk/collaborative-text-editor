import {
	IconArrowLeft,
	IconKeyframeAlignVertical,
	IconSearch,
	IconShare,
} from '@tabler/icons-react';
import { type Ref, useState } from 'react';
import { Link } from 'react-router';

import { AppAvatar } from '@/components/app-avatar';
import { DocumentTitleInput } from '@/components/document-title-input';
import { SaveStatusIndicator } from '@/components/save-status-indicator';
import { ShareDocumentDialog } from '@/components/share-document-dialog';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button, buttonVariants } from '@/components/ui/button';
import { ViewOnlyIndicator } from '@/components/view-only-indicator';
import type { DocumentSummary } from '@/hooks/use-documents.hook';
import type { SaveStatus } from '@/lib/document-sync.lib';

interface DocumentHeaderProps {
	document: DocumentSummary;
	saveStatus?: SaveStatus;
	isViewOnly?: boolean;
	onTitleDone: () => void;
	isSearchAndReplaceOpen: boolean;
	onSearchAndReplaceClick: () => void;
	searchAndReplaceButtonRef: Ref<HTMLButtonElement>;
}

export const DocumentHeader = ({
	document,
	saveStatus,
	isViewOnly,
	onTitleDone,
	isSearchAndReplaceOpen,
	onSearchAndReplaceClick,
	searchAndReplaceButtonRef,
}: DocumentHeaderProps) => {
	const [isShareDialogOpen, setIsShareDialogOpen] = useState(false);

	return (
		<header className="sticky top-0 z-50 flex h-(--document-header-height) items-center gap-1 border-b border-(--tt-toolbar-border-color) bg-(--tt-toolbar-bg-color) px-2 sm:gap-2 sm:px-3">
			<Link
				to="/"
				aria-label="Back to my documents"
				title="Back to my documents"
				className={buttonVariants({ variant: 'ghost', size: 'icon', className: 'shrink-0' })}
			>
				<IconArrowLeft className="sm:hidden" />
				<span className="flex size-6 items-center justify-center rounded-md bg-primary text-primary-foreground max-sm:hidden">
					<IconKeyframeAlignVertical className="size-4" />
				</span>
			</Link>

			<div className="flex min-w-0 flex-1">
				<DocumentTitleInput document={document} onDone={onTitleDone} />
			</div>

			<div className="flex shrink-0 items-center gap-1">
				{isViewOnly && <ViewOnlyIndicator />}
				{saveStatus && <SaveStatusIndicator status={saveStatus} />}
				<Button variant="outline" size="sm" onClick={() => setIsShareDialogOpen(true)}>
					<IconShare />
					<span className="max-sm:sr-only">Share</span>
				</Button>
				<Button
					ref={searchAndReplaceButtonRef}
					variant="ghost"
					size="icon"
					aria-label="Search and replace"
					title="Search and replace (Ctrl+F)"
					aria-expanded={isSearchAndReplaceOpen}
					onClick={onSearchAndReplaceClick}
				>
					<IconSearch />
				</Button>
				<ThemeToggle />
				<div className="flex pl-1">
					<AppAvatar />
				</div>
			</div>

			<ShareDocumentDialog
				document={document}
				open={isShareDialogOpen}
				onOpenChange={setIsShareDialogOpen}
			/>
		</header>
	);
};
