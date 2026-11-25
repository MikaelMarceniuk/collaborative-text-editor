import { createDocument, deleteDocument, inviteMember } from '../src/api.ts';
import { editorOf, openDocument, typeInEditor } from '../src/editor.ts';
import { expect, test } from '../src/fixtures.ts';
import { documentExists, savedVersionOf } from '../src/mongo.ts';
import { shareAndOpen } from '../src/scenario.ts';

// Only the "two-instances" project runs this file: Alice is on instance A and Bob on instance B, and the
// two only know about each other through Redis (docs/redis.md)
test.beforeEach(({ alice, bob }) => {
	expect([alice.instance, bob.instance]).toEqual(['a', 'b']);
});

test('someone who joins on the other instance gets what was not saved yet', async ({
	alice,
	bob,
}) => {
	const documentId = await createDocument(alice);
	await inviteMember(alice, documentId, bob, 'editor');

	await openDocument(alice.page, documentId);
	await typeInEditor(alice.page, 'Only instance A has this.');

	// The proof only holds while the text is not in the database: it goes there after the debounce (2s)
	expect(await savedVersionOf(documentId)).toBe(0);

	await openDocument(bob.page, documentId);
	await expect(editorOf(bob.page)).toContainText('Only instance A has this.');
});

test('a document deleted with people in it on both instances is gone, and does not come back', async ({
	alice,
	bob,
}) => {
	const documentId = await shareAndOpen(alice, bob, 'editor');

	// Text that is still waiting for the debounce on both instances: it must not be saved after the delete
	await typeInEditor(alice.page, 'Written just before the delete.');
	await expect(editorOf(bob.page)).toContainText('Written just before the delete.');

	await deleteDocument(alice, documentId);

	await expect(bob.page.getByText('Document not found')).toBeVisible();
	await expect(alice.page.getByText('Document not found')).toBeVisible();

	// A negative cannot be awaited, so this waits longer than the debounce (2s) and then looks
	await bob.page.waitForTimeout(3_000);
	expect(await documentExists(documentId)).toBe(false);
});
