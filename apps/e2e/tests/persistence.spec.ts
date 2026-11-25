import { createDocument, inviteMember } from '../src/api.ts';
import { contentOf, editorOf, openDocument, saveStatusOf, typeInEditor } from '../src/editor.ts';
import { expect, test } from '../src/fixtures.ts';
import { savedVersionOf } from '../src/mongo.ts';
import { installSocketSwitch } from '../src/network.ts';
import { shareAndOpen } from '../src/scenario.ts';

test('what was written is still there after a reload, and for someone who comes later', async ({
	alice,
	bob,
}) => {
	const documentId = await shareAndOpen(alice, bob, 'editor');
	await bob.page.close();

	await typeInEditor(alice.page, 'Written before the reload.');

	// "Saved" only says the server got the text. It reaches the database after the debounce (2s)
	await expect.poll(() => savedVersionOf(documentId), { timeout: 15_000 }).toBeGreaterThan(0);

	await alice.page.reload();
	await expect(editorOf(alice.page)).toContainText('Written before the reload.');

	// Alice leaves, so the room is not in memory when Bob arrives: the text can only come from the database
	await alice.page.goto('/');
	const latecomer = await bob.context.newPage();
	await openDocument(latecomer, documentId);
	await expect(editorOf(latecomer)).toContainText('Written before the reload.');
});

test('what is written while offline reaches the others when the connection is back', async ({
	alice,
	bob,
}) => {
	const documentId = await createDocument(alice);
	await inviteMember(alice, documentId, bob, 'editor');

	const bobsSocket = await installSocketSwitch(bob.page);
	await Promise.all([openDocument(alice.page, documentId), openDocument(bob.page, documentId)]);

	await bobsSocket.goOffline();
	await expect(saveStatusOf(bob.page)).toHaveText('Offline');

	await typeInEditor(bob.page, 'Bob offline. ');
	await typeInEditor(alice.page, 'Alice online. ');
	await expect(editorOf(alice.page)).not.toContainText('Bob offline.');

	bobsSocket.goOnline();

	await expect(saveStatusOf(bob.page)).toHaveText('Saved', { timeout: 20_000 });
	await expect.poll(() => contentOf(alice.page)).toContain('Bob offline.');
	await expect.poll(() => contentOf(bob.page)).toContain('Alice online.');
	await expect
		.poll(async () => (await contentOf(alice.page)) === (await contentOf(bob.page)))
		.toBe(true);
});
