import Collaboration from '@tiptap/extension-collaboration';
import { EditorContent, useEditor } from '@tiptap/react';
import { useMemo } from 'react';
import * as Y from 'yjs';

import { ImageUploadNode } from '@/components/tiptap-node/image-upload-node/image-upload-node-extension';
import { documentExtensions } from '@/lib/document-extensions.lib';

interface VersionPreviewProps {
	// The state of the document in that version (a Yjs update)
	snapshot: Uint8Array;
}

/**
 * The content of a version, read-only. It is a copy of the document in a Y.Doc of its own, with no socket:
 * showing it does not touch the document the others are editing.
 */
export const VersionPreview = ({ snapshot }: VersionPreviewProps) => {
	const ydoc = useMemo(() => {
		const copy = new Y.Doc();
		Y.applyUpdate(copy, snapshot);

		return copy;
	}, [snapshot]);

	const editor = useEditor(
		{
			immediatelyRender: false,
			editable: false,
			editorProps: {
				attributes: { class: 'simple-editor', 'aria-label': 'Content of the version' },
			},
			extensions: [
				...documentExtensions,
				// The schema has to know the node, even though nothing is uploaded here
				ImageUploadNode.configure({
					accept: 'image/*',
					upload: () => Promise.reject(new Error('A preview cannot upload')),
				}),
				Collaboration.configure({ document: ydoc }),
			],
		},
		[ydoc],
	);

	return <EditorContent editor={editor} role="presentation" className="simple-editor-content" />;
};
