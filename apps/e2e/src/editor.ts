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

/** The cursor of `name` as drawn in the editor of `page` (the label with the name is what marks it). */
export const caretOf = (page: Page, name: string) =>
	editorOf(page)
		.locator('.collaboration-carets__caret')
		.filter({
			has: page.locator('.collaboration-carets__label', { hasText: name }),
		});

/** The text of the block, up to the cursor of `name` as drawn in `page`; null when that cursor is not shown. */
export const textBeforeCaret = (page: Page, name: string) =>
	editorOf(page).evaluate((editor, caretName) => {
		const label = Array.from(editor.querySelectorAll('.collaboration-carets__label')).find(
			(element) => element.textContent === caretName,
		);
		const caret = label?.closest('.collaboration-carets__caret');
		if (!caret) return null;

		let block: Element = caret;
		while (block.parentElement && block.parentElement !== editor) block = block.parentElement;

		const range = document.createRange();
		range.setStart(block, 0);
		range.setEndBefore(caret);
		return range.toString();
	}, name);

/** How many characters of the first block come before the cursor, or the selection end, as the browser has it. */
const cursorOffsetOf = (page: Page) =>
	page.evaluate(() => {
		const selection = window.getSelection();
		const block = selection?.anchorNode?.parentElement?.closest('p');
		if (!selection?.anchorNode || !block) return -1;

		const range = document.createRange();
		range.setStart(block, 0);
		range.setEnd(selection.focusNode!, selection.focusOffset);
		return range.toString().length;
	});

/**
 * Puts the cursor `offset` characters after the start of the document, one key at a time, and checks that
 * the browser really has it there. ProseMirror sometimes applies its own selection in the middle of a key
 * sequence and undoes a move that was already made (the keys do reach the editor, none is cancelled, and
 * the presence shows where the cursor really is). So the whole sequence is repeated until it lands.
 */
export async function placeCursor(page: Page, offset: number) {
	await expect(async () => {
		await editorOf(page).click();
		await page.keyboard.press('ControlOrMeta+Home');
		for (let moved = 0; moved < offset; moved++) await page.keyboard.press('ArrowRight');

		await expect.poll(() => cursorOffsetOf(page), { timeout: 1_000 }).toBe(offset);
	}).toPass({ timeout: 15_000 });
}

/** Puts the cursor at `from` and selects the next `length` characters (see placeCursor). */
export async function selectText(page: Page, from: number, length: number) {
	await expect(async () => {
		await placeCursor(page, from);
		for (let selected = 0; selected < length; selected++) {
			await page.keyboard.press('Shift+ArrowRight');
		}

		await expect.poll(() => cursorOffsetOf(page), { timeout: 1_000 }).toBe(from + length);
	}).toPass({ timeout: 15_000 });
}
