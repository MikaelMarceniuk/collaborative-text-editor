import { createDocument, inviteMember } from '../src/api.ts';
import { editorOf, openDocument, typeInEditor } from '../src/editor.ts';
import { expect, test, type Person } from '../src/fixtures.ts';
import { savedVersionOf } from '../src/mongo.ts';

/** A document of `person` with `text` written in it, and saved to the database (that is where the search reads). */
async function writeDocument(person: Person, text: string) {
	const documentId = await createDocument(person);
	await openDocument(person.page, documentId);
	await typeInEditor(person.page, text);
	// "Saved" only says the server got the text. The search text reaches the database after the debounce (2s)
	await expect.poll(() => savedVersionOf(documentId), { timeout: 15_000 }).toBeGreaterThan(0);
	return documentId;
}

const searchBoxOf = (person: Person) => person.page.getByPlaceholder('Search documents...');
const resultsOf = (person: Person) => person.page.getByRole('option');

test('finds a document by what is written in it, ignoring case and accents, and opens it', async ({
	alice,
}) => {
	const wanted = await writeDocument(alice, 'A reunião sobre o orçamento de 2027 foi longa.');
	await writeDocument(alice, 'Lista de compras: pão e leite.');

	await alice.page.goto('/');
	await expect(resultsOf(alice)).toHaveCount(2);
	await searchBoxOf(alice).fill('ORCAMENTO');

	// Only the document that has the word is left, with the word marked where it was found
	await expect(resultsOf(alice)).toHaveCount(1);
	await expect(resultsOf(alice).locator('mark')).toHaveText('orçamento');
	await expect(resultsOf(alice)).toContainText('A reunião sobre o');

	await resultsOf(alice).click();
	await expect(alice.page).toHaveURL(new RegExp(`/${wanted}$`));
	await expect(editorOf(alice.page)).toContainText('orçamento de 2027');
});

test('wants every word, and whole words only', async ({ alice }) => {
	await writeDocument(alice, 'The plan and the project.');
	await writeDocument(alice, 'Only the plan, nothing else.');

	await alice.page.goto('/');
	await searchBoxOf(alice).fill('plan project');
	await expect(resultsOf(alice)).toHaveCount(1);
	await expect(resultsOf(alice).locator('mark')).toHaveText(['plan', 'project']);

	// "proj" is not a word of the text
	await searchBoxOf(alice).fill('proj');
	await expect(
		alice.page.getByText('No documents have "proj" in the title or the text.'),
	).toBeVisible();
});

test('only finds documents the person has access to', async ({ alice, bob }) => {
	const documentId = await writeDocument(alice, 'The migration of the tortoises.');

	await bob.page.goto('/');
	await searchBoxOf(bob).fill('tortoises');
	await expect(
		bob.page.getByText('No documents have "tortoises" in the title or the text.'),
	).toBeVisible();

	// Once the document is shared, Bob finds it, with Alice's words in it
	await inviteMember(alice, documentId, bob, 'viewer');
	await bob.page.reload();
	await searchBoxOf(bob).fill('tortoises');
	await expect(resultsOf(bob)).toHaveCount(1);
	await expect(resultsOf(bob).locator('mark')).toHaveText('tortoises');
});
