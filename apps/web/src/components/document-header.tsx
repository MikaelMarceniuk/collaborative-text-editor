import { IconArrowLeft, IconKeyframeAlignVertical, IconSearch } from '@tabler/icons-react';
import type { Ref } from 'react';
import { Link } from 'react-router';

import { AppAvatar } from '@/components/app-avatar';
import { DocumentTitleInput } from '@/components/document-title-input';
import { SaveStatusIndicator } from '@/components/save-status-indicator';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button, buttonVariants } from '@/components/ui/button';
import type { DocumentSummary } from '@/hooks/use-documents.hook';
import type { SaveStatus } from '@/lib/document-sync.lib';

interface DocumentHeaderProps {
	document: DocumentSummary;
	saveStatus?: SaveStatus;
	onTitleDone: () => void;
	isSearchAndReplaceOpen: boolean;
	onSearchAndReplaceClick: () => void;
	searchAndReplaceButtonRef: Ref<HTMLButtonElement>;
}

export const DocumentHeader = ({
	document,
	saveStatus,
	onTitleDone,
	isSearchAndReplaceOpen,
	onSearchAndReplaceClick,
	searchAndReplaceButtonRef,
}: DocumentHeaderProps) => (
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
			{saveStatus && <SaveStatusIndicator status={saveStatus} />}
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
	</header>
);
