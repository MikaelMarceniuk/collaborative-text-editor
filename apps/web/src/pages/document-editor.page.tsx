import {
	IconAlertTriangle,
	IconArrowLeft,
	IconFileOff,
	IconLoader2,
	IconRefresh,
} from '@tabler/icons-react';
import { useEffect } from 'react';
import { Link, useParams } from 'react-router';

import { SimpleEditor } from '@/components/tiptap-templates/simple/simple-editor';
import { Button, buttonVariants } from '@/components/ui/button';
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from '@/components/ui/empty';
import { useDocument } from '@/hooks/use-documents.hook';

const useDocumentTitle = (title: string | undefined) => {
	useEffect(() => {
		if (!title) return;

		const previousTitle = window.document.title;
		window.document.title = title;

		return () => {
			window.document.title = previousTitle;
		};
	}, [title]);
};

const backToDocumentsLink = (
	<Link to="/" className={buttonVariants({ size: 'sm', variant: 'outline' })}>
		<IconArrowLeft />
		Back to my documents
	</Link>
);

export const DocumentEditorPage = () => {
	const { id } = useParams<'id'>();
	const { document, isDocumentPending, isDocumentError, isDocumentNotFound, refetchDocument } =
		useDocument(id!);

	useDocumentTitle(document?.title);

	if (isDocumentPending) {
		return (
			<div className="flex min-h-svh items-center justify-center gap-2 text-sm text-muted-foreground">
				<IconLoader2 className="size-4 animate-spin" />
				Loading document…
			</div>
		);
	}

	if (isDocumentNotFound) {
		return (
			<Empty className="min-h-svh">
				<EmptyHeader>
					<EmptyMedia variant="icon">
						<IconFileOff />
					</EmptyMedia>
					<EmptyTitle>Document not found</EmptyTitle>
					<EmptyDescription>
						It may have been deleted, or you don&apos;t have access to it.
					</EmptyDescription>
				</EmptyHeader>
				<EmptyContent>{backToDocumentsLink}</EmptyContent>
			</Empty>
		);
	}

	if (isDocumentError || !document) {
		return (
			<Empty className="min-h-svh">
				<EmptyHeader>
					<EmptyMedia variant="icon">
						<IconAlertTriangle />
					</EmptyMedia>
					<EmptyTitle>Couldn&apos;t load this document</EmptyTitle>
					<EmptyDescription>Something went wrong while fetching the document.</EmptyDescription>
				</EmptyHeader>
				<EmptyContent className="flex-row justify-center">
					{backToDocumentsLink}
					<Button size="sm" onClick={() => void refetchDocument()}>
						<IconRefresh />
						Try again
					</Button>
				</EmptyContent>
			</Empty>
		);
	}

	return <SimpleEditor key={document._id} document={document} />;
};
