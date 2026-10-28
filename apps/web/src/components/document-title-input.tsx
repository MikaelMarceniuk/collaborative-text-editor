import { cn } from 'cn';
import { type KeyboardEvent, useRef, useState } from 'react';

import {
	canEditDocument,
	DOCUMENT_TITLE_MAX_LENGTH,
	type DocumentSummary,
} from '@/hooks/use-documents.hook';
import { useRenameDocument } from '@/hooks/use-rename-document.hook';
import { useAuthenticatedSession } from '@/hooks/use-session.hook';

const titleClassName = 'px-2 py-1 text-base font-medium sm:text-lg';

interface DocumentTitleInputProps {
	document: DocumentSummary;
	onDone?: () => void;
}

export const DocumentTitleInput = ({ document, onDone }: DocumentTitleInputProps) => {
	const { user } = useAuthenticatedSession();
	const { handleRenameDocument } = useRenameDocument();
	const [draft, setDraft] = useState<string | null>(null);
	const isCancelingRef = useRef(false);

	const role = document.members.find((member) => member.userId === user.id)?.role;

	if (!canEditDocument(role)) {
		return (
			<h1 className={cn(titleClassName, 'min-w-0 truncate')} title={document.title}>
				{document.title}
			</h1>
		);
	}

	const value = draft ?? document.title;

	const handleBlur = () => {
		const title = value.trim();
		setDraft(null);

		if (isCancelingRef.current) {
			isCancelingRef.current = false;
			return;
		}

		if (title && title !== document.title) {
			handleRenameDocument(document._id, title);
		}
	};

	const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if (event.key !== 'Enter' && event.key !== 'Escape') return;

		event.preventDefault();
		isCancelingRef.current = event.key === 'Escape';
		event.currentTarget.blur();
		onDone?.();
	};

	return (
		<div className="grid min-w-0 grid-cols-[minmax(0,auto)]">
			<span
				aria-hidden
				className={cn(
					titleClassName,
					'invisible col-start-1 row-start-1 min-w-0 overflow-hidden border border-transparent whitespace-pre',
				)}
			>
				{value || ' '}
			</span>
			<input
				aria-label="Rename document"
				spellCheck={false}
				maxLength={DOCUMENT_TITLE_MAX_LENGTH}
				value={value}
				onFocus={(event) => {
					setDraft(document.title);
					event.currentTarget.select();
				}}
				onChange={(event) => setDraft(event.target.value)}
				onBlur={handleBlur}
				onKeyDown={handleKeyDown}
				className={cn(
					titleClassName,
					'col-start-1 row-start-1 w-full min-w-0 overflow-hidden rounded-md border border-transparent bg-transparent text-ellipsis text-foreground outline-none hover:border-border focus:border-ring focus:ring-2 focus:ring-ring/30',
				)}
			/>
		</div>
	);
};
