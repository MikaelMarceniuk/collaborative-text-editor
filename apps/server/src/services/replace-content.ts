import * as Y from 'yjs';

import { CONTENT_FIELD } from './document-content.service.js';

/**
 * Makes the content of `ydoc` equal to the content of `snapshot`, as an edit like any other, and returns the update
 * that edit produced (null if there was nothing to write).
 *
 * It cannot be done by applying the snapshot: merging is a union, and the old state is already contained in the
 * current one. So the current content is deleted and copies of the old content are inserted. The copies are new
 * items with new ids, which is what lets every replica (and a client that was offline) accept them without
 * bringing back what was deleted.
 */
export const replaceContent = (ydoc: Y.Doc, snapshot: Uint8Array) => {
	const source = new Y.Doc();
	Y.applyUpdate(source, snapshot);
	const copies = source
		.getXmlFragment(CONTENT_FIELD)
		.toArray()
		// The editor writes elements and text, never hooks
		.filter((node): node is Y.XmlElement | Y.XmlText => !(node instanceof Y.XmlHook))
		.map((node) => node.clone());

	let update: Uint8Array | null = null;
	const capture = (produced: Uint8Array) => {
		update = produced;
	};

	ydoc.on('update', capture);
	try {
		ydoc.transact(() => {
			const fragment = ydoc.getXmlFragment(CONTENT_FIELD);

			fragment.delete(0, fragment.length);
			fragment.insert(0, copies);
		});
	} finally {
		ydoc.off('update', capture);
	}

	return update;
};
