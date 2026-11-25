import { createDocument } from '../src/api.ts';
import { expect, test } from '../src/fixtures.ts';

test('the owner invites, changes the role and removes a person', async ({ alice, bob }) => {
	await createDocument(alice);

	await alice.page.goto('/');
	await alice.page.getByRole('button', { name: 'Actions for Untitled document' }).click();
	await alice.page.getByRole('menuitem', { name: 'Share' }).click();

	const dialog = alice.page.getByRole('dialog', { name: 'Share document' });
	await dialog.getByLabel('Email of the person to invite').fill(bob.email);
	await dialog.getByRole('button', { name: 'Role of the person to invite' }).click();
	await alice.page.getByRole('menuitemradio', { name: 'Can edit' }).click();
	await dialog.getByRole('button', { name: 'Invite', exact: true }).click();

	await expect(dialog.getByRole('button', { name: 'Remove Bob' })).toBeVisible();

	// Bob finds the document in his list, with the role the owner gave
	const bobsDocument = bob.page.getByRole('option', { name: /Untitled document/ });
	await bob.page.goto('/');
	await expect(bobsDocument).toContainText('Shared · Can edit');

	await dialog.getByRole('button', { name: 'Role of Bob' }).click();
	await alice.page.getByRole('menuitemradio', { name: 'View only' }).click();
	await expect(dialog.getByRole('button', { name: 'Role of Bob' })).toHaveText('View only');

	await bob.page.reload();
	await expect(bobsDocument).toContainText('Shared · View only');

	await dialog.getByRole('button', { name: 'Remove Bob' }).click();
	await expect(dialog.getByRole('button', { name: 'Remove Bob' })).toHaveCount(0);

	await bob.page.reload();
	await expect(bob.page.getByRole('button', { name: 'New', exact: true })).toBeVisible();
	await expect(bobsDocument).toHaveCount(0);
});
