import { changeMemberRole, removeMember } from '../src/api.ts';
import { contentOf, editorOf, saveStatusOf, typeInEditor } from '../src/editor.ts';
import { expect, test, type Person } from '../src/fixtures.ts';
import { shareAndOpen } from '../src/scenario.ts';

const textOf = (person: Person) => contentOf(person.page);

test('two people typing at the same time end up with the same document', async ({ alice, bob }) => {
	await shareAndOpen(alice, bob, 'editor');

	await typeInEditor(alice.page, 'Hello from Alice. ');
	await expect(editorOf(bob.page)).toContainText('Hello from Alice.');

	await typeInEditor(bob.page, 'Hello from Bob. ');
	await expect(editorOf(alice.page)).toContainText('Hello from Bob.');

	// Both at once, a key at a time, so the updates cross each other on the way
	const fromAlice = 'The quick brown fox jumps over the lazy dog. ';
	const fromBob = 'Pack my box with five dozen liquor jugs. ';
	await Promise.all([
		alice.page.keyboard.type(fromAlice, { delay: 10 }),
		bob.page.keyboard.type(fromBob, { delay: 10 }),
	]);

	await expect.poll(() => textOf(alice)).toContain(fromAlice);
	await expect.poll(() => textOf(alice)).toContain(fromBob);
	await expect.poll(async () => (await textOf(alice)) === (await textOf(bob))).toBe(true);
});

test('a viewer sees what is typed, but cannot type', async ({ alice, bob }) => {
	await shareAndOpen(alice, bob, 'viewer');

	await expect(bob.page.getByRole('status').filter({ hasText: 'View only' })).toBeVisible();
	await expect(editorOf(bob.page)).toHaveAttribute('contenteditable', 'false');

	await typeInEditor(alice.page, 'Only Alice writes here.');
	await expect(editorOf(bob.page)).toContainText('Only Alice writes here.');

	await editorOf(bob.page).click();
	await bob.page.keyboard.type('BOB SHOULD NOT BE ABLE TO');
	await expect(editorOf(bob.page)).not.toContainText('BOB SHOULD');
	await expect(editorOf(alice.page)).not.toContainText('BOB SHOULD');
});

test('a role changed with the document open takes effect without a reload', async ({
	alice,
	bob,
}) => {
	const documentId = await shareAndOpen(alice, bob, 'editor');

	await typeInEditor(bob.page, 'Bob can write now. ');
	await expect(editorOf(alice.page)).toContainText('Bob can write now.');

	await changeMemberRole(alice, documentId, bob, 'viewer');

	await expect(bob.page.getByText('Your access to this document changed')).toBeVisible();
	await expect(bob.page.getByRole('status').filter({ hasText: 'View only' })).toBeVisible();
	await expect(editorOf(bob.page)).toHaveAttribute('contenteditable', 'false');
	// What was written before is still there
	await expect(editorOf(bob.page)).toContainText('Bob can write now.');

	await editorOf(bob.page).click();
	await bob.page.keyboard.type('TYPED AFTER THE CHANGE');
	await typeInEditor(alice.page, 'Alice goes on.');

	await expect(editorOf(bob.page)).toContainText('Alice goes on.');
	await expect(editorOf(alice.page)).not.toContainText('TYPED AFTER THE CHANGE');
	await expect(saveStatusOf(alice.page)).toHaveText('Saved');
});

test('a person removed with the document open is sent out of it', async ({ alice, bob }) => {
	const documentId = await shareAndOpen(alice, bob, 'editor');

	await removeMember(alice, documentId, bob);

	await expect(bob.page.getByText('Document not found')).toBeVisible();
	await expect(editorOf(bob.page)).toHaveCount(0);

	// The owner is not affected
	await expect(editorOf(alice.page)).toBeVisible();
});
