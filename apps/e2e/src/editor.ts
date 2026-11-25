import { expect, type Page } from '@playwright/test';

export const editorOf = (page: Page) => page.getByRole('textbox', { name: /Main content area/ });

/** "Saved", "Saving…" or "Offline", whatever the header shows now. */
export const saveStatusOf = (page: Page) =>
	page.getByRole('status').filter({ hasText: /Saved|Saving|Offline/ });

/** Opens the document and waits until the editor is there and the first sync is done. */
export async function openDocument(page: Page, documentId: string) {
	await page.goto(`/${documentId}`);
	await expect(editorOf(page)).toBeVisible();
	await expect(saveStatusOf(page)).toHaveText('Saved');
}

/** Types like a person would, one key at a time, at the end of the document. */
export async function typeInEditor(page: Page, text: string) {
	const editor = editorOf(page);
	await editor.click();
	await page.keyboard.press('ControlOrMeta+End');
	await page.keyboard.type(text);
}
