import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';

export const FLIPPED_CARET_CLASS = 'collaboration-carets__caret--flipped';

// Space kept between a label and the edge of the screen
const EDGE_MARGIN_PX = 8;

/**
 * The name label of a remote cursor starts at the cursor and extends to the right, so a cursor near the right edge
 * (common on a phone) pushes its label off the screen. This flips the label to extend to the left when it would not
 * fit. The cursors are widgets that ProseMirror moves and reuses as the text changes, so the placement is
 * recomputed after every view update, and on resize.
 */
const placeLabels = (view: EditorView) => {
	const carets = view.dom.querySelectorAll<HTMLElement>('.collaboration-carets__caret');
	if (carets.length === 0) return;

	const rightEdge = document.documentElement.clientWidth - EDGE_MARGIN_PX;

	for (const caret of carets) {
		const label = caret.querySelector<HTMLElement>('.collaboration-carets__label');
		if (!label) continue;

		const wouldEndAt = caret.getBoundingClientRect().left + label.offsetWidth;
		caret.classList.toggle(FLIPPED_CARET_CLASS, wouldEndAt > rightEdge);
	}
};

export const CaretLabelPlacement = Extension.create({
	name: 'caretLabelPlacement',

	addProseMirrorPlugins() {
		return [
			new Plugin({
				key: new PluginKey('caretLabelPlacement'),
				view: (view) => {
					const handleResize = () => placeLabels(view);
					window.addEventListener('resize', handleResize);

					return {
						update: placeLabels,
						destroy: () => window.removeEventListener('resize', handleResize),
					};
				},
			}),
		];
	},
});
