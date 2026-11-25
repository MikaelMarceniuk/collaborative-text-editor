import { createDocument, inviteMember, type Role } from './api.ts';
import { openDocument } from './editor.ts';
import type { Person } from './fixtures.ts';

/** Alice owns a document that Bob can open with the given role. Both have it open when this returns. */
export async function shareAndOpen(alice: Person, bob: Person, role: Role) {
	const documentId = await createDocument(alice);
	await inviteMember(alice, documentId, bob, role);

	await Promise.all([openDocument(alice.page, documentId), openDocument(bob.page, documentId)]);
	return documentId;
}
