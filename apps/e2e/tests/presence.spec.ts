import {
	caretOf,
	contentOf,
	editorOf,
	openDocument,
	placeCursor,
	selectText,
	textBeforeCaret,
	typeInEditor,
} from '../src/editor.ts';
import { expect, test, type Person } from '../src/fixtures.ts';
import { shareAndOpen } from '../src/scenario.ts';

const peopleIn = (person: Person, names: string) =>
	person.page.getByRole('group', { name: `People in this document: ${names}` });

test('shows who else is in the document, once per person, and drops who leaves', async ({
	alice,
	bob,
}) => {
	const documentId = await shareAndOpen(alice, bob, 'editor');

	await expect(peopleIn(alice, 'Bob')).toBeVisible();
	await expect(peopleIn(bob, 'Alice')).toBeVisible();

	// A second tab of Bob is still one Bob
	const bobsOtherTab = await bob.context.newPage();
	await openDocument(bobsOtherTab, documentId);
	await expect(peopleIn(alice, 'Bob').getByTitle('Bob')).toHaveCount(1);

	// Closing one tab is not leaving. Closing the last one is
	await bobsOtherTab.close();
	await expect(peopleIn(alice, 'Bob')).toBeVisible();

	await bob.page.close();
	await expect(alice.page.getByRole('group', { name: /People in this document/ })).toHaveCount(0);
});

const TEXT = 'Hello world from Alice';

/**
 * Moves the cursor of `mover` to `offset` and waits until `viewer` shows it there. Retried as a whole:
 * under heavy load (several workers) ProseMirror sometimes keeps its own selection a step behind the one
 * the browser has when the keys come within a few milliseconds, and then nothing publishes the final
 * position until the next move. A person does not type that fast (see "Diferenças do plano" in docs/e2e.md).
 */
async function moveCursorAndExpectSeen(mover: Person, viewer: Person, offset: number) {
	await expect(async () => {
		await placeCursor(mover.page, offset);
		await expect(caretOf(viewer.page, mover.name)).toBeVisible({ timeout: 2_000 });
		await expect
			.poll(() => textBeforeCaret(viewer.page, mover.name), { timeout: 2_000 })
			.toBe(TEXT.slice(0, offset));
	}).toPass({ timeout: 20_000 });
}

test('shows the cursor and the selection of the others, both ways, in their color', async ({
	alice,
	bob,
}) => {
	await shareAndOpen(alice, bob, 'editor');
	await typeInEditor(alice.page, TEXT);
	await expect(editorOf(bob.page)).toContainText(TEXT);

	// Bob puts the cursor after "Hello": Alice sees his label there
	await moveCursorAndExpectSeen(bob, alice, 5);

	// The color of the label is the one of his avatar in the header
	const avatarColor = await peopleIn(alice, 'Bob')
		.locator('[style*="background-color"]')
		.first()
		.evaluate((element) => getComputedStyle(element).backgroundColor);
	await expect(caretOf(alice.page, 'Bob').locator('.collaboration-carets__label')).toHaveCSS(
		'background-color',
		avatarColor,
	);

	// Bob selects "Hello": Alice sees it highlighted
	await expect(async () => {
		await selectText(bob.page, 0, 5);
		await expect(alice.page.locator('.ProseMirror-yjs-selection').first()).toHaveText('Hello', {
			timeout: 2_000,
		});
	}).toPass({ timeout: 20_000 });

	// And the other way: Alice moves, Bob sees it
	await moveCursorAndExpectSeen(alice, bob, 3);
});

test('the cursor of the other person does not disappear while they type', async ({
	alice,
	bob,
}) => {
	await shareAndOpen(alice, bob, 'editor');

	await typeInEditor(bob.page, 'x');
	await expect(caretOf(alice.page, 'Bob')).toBeVisible();

	// Looks at every frame of Alice's screen. The cursor used to flicker out when it got ahead of the text
	await alice.page.evaluate(() => {
		const samples = { frames: 0, missing: 0, stop: false };
		(globalThis as unknown as { caretSamples: typeof samples }).caretSamples = samples;

		const look = () => {
			samples.frames++;
			if (!document.querySelector('.collaboration-carets__label')) samples.missing++;
			if (!samples.stop) requestAnimationFrame(look);
		};
		requestAnimationFrame(look);
	});

	const typed = 'The cursor stays where the text is. '.repeat(4);
	await bob.page.keyboard.type(typed, { delay: 20 });
	await expect.poll(() => contentOf(alice.page)).toContain(typed);

	const { frames, missing } = await alice.page.evaluate(() => {
		const samples = (
			globalThis as unknown as { caretSamples: { frames: number; missing: number; stop: boolean } }
		).caretSamples;
		samples.stop = true;
		return samples;
	});

	expect(frames).toBeGreaterThan(30);
	expect(missing).toBe(0);
});
