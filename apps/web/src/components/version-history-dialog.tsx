import { IconAlertTriangle, IconHistory, IconRefresh } from '@tabler/icons-react';
import { cn } from 'cn';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { VersionPreview } from '@/components/version-preview';
import {
	type DocumentVersion,
	type DocumentVersionKind,
	useDocumentVersions,
	useVersionSnapshot,
} from '@/hooks/use-document-versions.hook';
import type { DocumentSummary } from '@/hooks/use-documents.hook';
import { formatRelativeTime } from '@/lib/date.lib';

const KIND_LABELS: Record<DocumentVersionKind, string> = {
	auto: 'Autosaved',
	manual: 'Saved version',
	'before-restore': 'Before a restore',
};

const versionTitle = (version: DocumentVersion) => version.label ?? KIND_LABELS[version.kind];

const versionSubtitle = (version: DocumentVersion) => {
	const when = formatRelativeTime(version.createdAt);

	return version.createdBy ? `${when} · ${version.createdBy.name ?? 'Someone'}` : when;
};

const VersionsSkeleton = () => (
	<div aria-hidden className="flex flex-col gap-3">
		{Array.from({ length: 4 }, (_, index) => (
			<div key={index} className="flex flex-col gap-1.5">
				<Skeleton className="h-3.5 w-32" />
				<Skeleton className="h-3 w-24" />
			</div>
		))}
	</div>
);

const Message = ({ children }: { children: React.ReactNode }) => (
	<div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted-foreground">
		{children}
	</div>
);

interface PreviewProps {
	documentId: string;
	versionId: string | undefined;
}

const Preview = ({ documentId, versionId }: PreviewProps) => {
	const { snapshot, isSnapshotPending, isSnapshotError, refetchSnapshot } = useVersionSnapshot(
		documentId,
		versionId,
	);

	if (!versionId) return <Message>Select a version to see what it had.</Message>;

	if (isSnapshotPending) {
		return (
			<div aria-hidden className="flex flex-col gap-3 p-6">
				<Skeleton className="h-6 w-1/2" />
				<Skeleton className="h-4 w-full" />
				<Skeleton className="h-4 w-4/5" />
			</div>
		);
	}

	if (isSnapshotError || !snapshot) {
		return (
			<Message>
				<IconAlertTriangle className="size-5" />
				Couldn&apos;t load this version.
				<Button size="sm" variant="outline" onClick={() => void refetchSnapshot()}>
					<IconRefresh />
					Try again
				</Button>
			</Message>
		);
	}

	// A version with nothing in it still shows an empty page, which is what it is
	return <VersionPreview key={versionId} snapshot={snapshot} />;
};

interface VersionHistoryDialogProps {
	document: DocumentSummary;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

export const VersionHistoryDialog = ({
	document,
	open,
	onOpenChange,
}: VersionHistoryDialogProps) => {
	const { versions, isVersionsPending, isVersionsError, refetchVersions } = useDocumentVersions(
		document._id,
		{ enabled: open },
	);
	const [selectedId, setSelectedId] = useState<string>();

	// Until the person chooses, the newest version is the one shown
	const selected = versions.find((version) => version._id === selectedId) ?? versions[0];

	const renderList = () => {
		if (isVersionsPending) return <VersionsSkeleton />;

		if (isVersionsError) {
			return (
				<Message>
					<IconAlertTriangle className="size-5" />
					Couldn&apos;t load the history.
					<Button size="sm" variant="outline" onClick={() => void refetchVersions()}>
						<IconRefresh />
						Try again
					</Button>
				</Message>
			);
		}

		if (versions.length === 0) {
			return (
				<Message>
					<IconHistory className="size-5" />
					No versions yet. They are saved as the document is edited.
				</Message>
			);
		}

		return (
			<ul className="flex flex-col gap-1">
				{versions.map((version) => (
					<li key={version._id}>
						<button
							type="button"
							aria-current={version._id === selected?._id}
							onClick={() => setSelectedId(version._id)}
							className={cn(
								'flex w-full flex-col rounded-lg px-2.5 py-2 text-left outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50',
								version._id === selected?._id && 'bg-muted',
							)}
						>
							<span className="truncate text-sm font-medium">{versionTitle(version)}</span>
							<span className="truncate text-xs text-muted-foreground">
								{versionSubtitle(version)}
							</span>
						</button>
					</li>
				))}
			</ul>
		);
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-4xl">
				<DialogHeader>
					<DialogTitle>Version history</DialogTitle>
					<DialogDescription className="truncate">{document.title}</DialogDescription>
				</DialogHeader>

				<div className="grid h-[65vh] gap-3 sm:grid-cols-[15rem_1fr]">
					<div className="overflow-y-auto max-sm:max-h-40">{renderList()}</div>
					<div className="overflow-y-auto rounded-lg border bg-background">
						<Preview documentId={document._id} versionId={selected?._id} />
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
};
