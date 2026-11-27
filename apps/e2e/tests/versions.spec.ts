import { createDocument, inviteMember, saveVersion } from '../src/api.ts';
import { editorOf, openDocument, saveStatusOf, typeInEditor } from '../src/editor.ts';
import { expect, test, type Person } from '../src/fixtures.ts';
import { shareAndOpen } from '../src/scenario.ts';

const historyOf = (person: Person) => person.page.getByRole('dialog', { name: 'Version history' });

async function openHistory(person: Person) {
	await person.page.getByRole('button', { name: 'Version history' }).click();
	const history = historyOf(person);
	await expect(history).toBeVisible();
	return history;
}

test('restoring a version puts its text back for everyone who has the document open', async ({
	alice,
	bob,
}) => {
	await shareAndOpen(alice, bob, 'editor');
	await typeInEditor(alice.page, 'The first draft.');
	await expect(editorOf(bob.page)).toContainText('The first draft.');

	// Alice keeps this moment, with a name
	let history = await openHistory(alice);
	await history.getByLabel('Name of the version').fill('First draft');
	await history.getByRole('button', { name: 'Save version' }).click();
	await expect(history.getByRole('button', { name: /First draft/ })).toBeVisible();
	await alice.page.keyboard.press('Escape');
	await expect(history).toBeHidden();

	// And then the document goes somewhere else
	await editorOf(alice.page).click();
	await alice.page.keyboard.press('ControlOrMeta+A');
	await alice.page.keyboard.type('Something else entirely.');
	await expect(editorOf(bob.page)).toContainText('Something else entirely.');
	await expect(editorOf(bob.page)).not.toContainText('The first draft.');
	await expect(saveStatusOf(alice.page)).toHaveText('Saved');

	// Looking at the old version changes nothing in the document
	history = await openHistory(alice);
	await history.getByRole('button', { name: /First draft/ }).click();
	await expect(history.getByLabel('Content of the version')).toContainText('The first draft.');
	await expect(editorOf(bob.page)).toContainText('Something else entirely.');

	await history.getByRole('button', { name: 'Restore this version' }).click();
	await alice.page.getByRole('alertdialog').getByRole('button', { name: 'Restore' }).click();

	for (const person of [alice, bob]) {
		await expect(editorOf(person.page)).toContainText('The first draft.');
		await expect(editorOf(person.page)).not.toContainText('Something else entirely.');
	}
	await expect(history).toBeHidden();

	// What was there before is kept, so the restore can be undone
	history = await openHistory(alice);
	await history.getByRole('button', { name: /Before a restore/ }).click();
	await expect(history.getByLabel('Content of the version')).toContainText(
		'Something else entirely.',
	);
});

test('a viewer reads the history but cannot save or restore', async ({ alice, bob }) => {
	const documentId = await createDocument(alice);
	await inviteMember(alice, documentId, bob, 'viewer');
	await openDocument(alice.page, documentId);
	await typeInEditor(alice.page, 'Written by Alice.');
	await expect(saveStatusOf(alice.page)).toHaveText('Saved');
	await saveVersion(alice, documentId, 'Alice checkpoint');

	await openDocument(bob.page, documentId);
	const history = await openHistory(bob);

	await expect(history.getByRole('button', { name: /Alice checkpoint/ })).toBeVisible();
	await expect(history.getByLabel('Content of the version')).toContainText('Written by Alice.');
	await expect(history.getByRole('button', { name: 'Save version' })).toHaveCount(0);
	await expect(history.getByRole('button', { name: 'Restore this version' })).toHaveCount(0);
});
