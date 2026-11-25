import type { Person } from './fixtures.ts';

export type Role = 'editor' | 'viewer';

async function expectOk(response: { ok(): boolean; status(): number; text(): Promise<string> }) {
	if (!response.ok()) throw new Error(`${response.status()} ${await response.text()}`);
}

/** Creates an empty document owned by `owner` and returns its id. */
export async function createDocument(owner: Person) {
	const response = await owner.request.post('/api/documents', {
		headers: { origin: owner.origin },
	});
	await expectOk(response);

	const { document } = (await response.json()) as { document: { _id: string } };
	return document._id;
}

export async function inviteMember(owner: Person, documentId: string, guest: Person, role: Role) {
	const response = await owner.request.post(`/api/documents/${documentId}/members`, {
		data: { email: guest.email, role },
		headers: { origin: owner.origin },
	});
	await expectOk(response);
}
