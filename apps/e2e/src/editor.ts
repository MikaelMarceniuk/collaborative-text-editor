import { expect, type Page } from '@playwright/test';

export const editorOf = (page: Page) => page.getByRole('textbox', { name: /Main content area/ });

/** "Saved", "Saving…" or "Offline", whatever the header shows now. */
export const saveStatusOf = (page: Page) =>
	page.getByRole('status').filter({ hasText: /Saved|Saving|Offline/ });

/**
 * What is written in the document, one line per block. The labels of the other people's cursors are
 * elements inside the editor too (their names), so they are left out: they are not content.
 */
export const contentOf = (page: Page) =>
	editorOf(page).evaluate((editor) => {
		const copy = editor.cloneNode(true) as HTMLElement;
		copy.querySelectorAll('.collaboration-carets__caret').forEach((caret) => caret.remove());
		return Array.from(copy.children, (block) => block.textContent).join('\n');
	});

/** Opens the document and waits until the editor is there and the first sync is done. */
export async function openDocument(page: Page, documentId: string) {
	await page.goto(`/${documentId}`);
	await expect(editorOf(page)).toBeVisible();
	// A viewer has no save status: the header shows that the document is view only instead
	await expect(page.getByRole('status').filter({ hasText: /^(Saved|View only)$/ })).toBeVisible();
}

/** Types like a person would, one key at a time, at the end of the document. */
export async function typeInEditor(page: Page, text: string) {
	const editor = editorOf(page);
	await editor.click();
	await page.keyboard.press('ControlOrMeta+End');
	await page.keyboard.type(text);
}
