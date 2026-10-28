import type { FormEvent } from 'react';
import { useRef } from 'react';

import { Button } from '@/components/ui/button';
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { DOCUMENT_TITLE_MAX_LENGTH, type DocumentSummary } from '@/hooks/use-documents.hook';
import { useRenameDocument } from '@/hooks/use-rename-document.hook';

interface RenameDocumentDialogProps {
	document: DocumentSummary | null;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

export const RenameDocumentDialog = ({
	document,
	open,
	onOpenChange,
}: RenameDocumentDialogProps) => {
	const { handleRenameDocument } = useRenameDocument();
	const inputRef = useRef<HTMLInputElement>(null);

	const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (!document) return;

		const title = String(new FormData(event.currentTarget).get('title') ?? '').trim();
		if (title && title !== document.title) {
			handleRenameDocument(document._id, title);
		}

		onOpenChange(false);
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent initialFocus={inputRef}>
				<form className="flex flex-col gap-4" onSubmit={handleSubmit}>
					<DialogHeader>
						<DialogTitle>Rename document</DialogTitle>
					</DialogHeader>

					<Input
						ref={inputRef}
						name="title"
						aria-label="Document title"
						required
						maxLength={DOCUMENT_TITLE_MAX_LENGTH}
						defaultValue={document?.title}
						onFocus={(event) => event.currentTarget.select()}
					/>

					<DialogFooter>
						<DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
						<Button type="submit">Rename</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
};
