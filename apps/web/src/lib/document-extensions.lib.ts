import { Highlight } from '@tiptap/extension-highlight';
import { Image } from '@tiptap/extension-image';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { Subscript } from '@tiptap/extension-subscript';
import { Superscript } from '@tiptap/extension-superscript';
import { TextAlign } from '@tiptap/extension-text-align';
import { Typography } from '@tiptap/extension-typography';
import { StarterKit } from '@tiptap/starter-kit';

import { HorizontalRule } from '@/components/tiptap-node/horizontal-rule-node/horizontal-rule-node-extension';

/**
 * The nodes and marks a document can have. The editor and the preview of a version must share them: the content
 * is stored as Yjs, and a node the schema does not know cannot be shown.
 */
export const documentExtensions = [
	StarterKit.configure({
		horizontalRule: false,
		undoRedo: false,
		link: {
			openOnClick: false,
			enableClickSelection: true,
		},
	}),
	HorizontalRule,
	TextAlign.configure({ types: ['heading', 'paragraph'] }),
	TaskList,
	TaskItem.configure({ nested: true }),
	Highlight.configure({ multicolor: true }),
	Image,
	Typography,
	Superscript,
	Subscript,
];
