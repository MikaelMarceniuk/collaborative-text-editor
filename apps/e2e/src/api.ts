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

/** The id the server knows the person by (the members routes use it). */
export async function userIdOf(person: Person) {
	const response = await person.request.get('/api/auth/get-session');
	await expectOk(response);

	const session = (await response.json()) as { user: { id: string } };
	return session.user.id;
}

export async function changeMemberRole(
	owner: Person,
	documentId: string,
	member: Person,
	role: Role,
) {
	const response = await owner.request.patch(
		`/api/documents/${documentId}/members/${await userIdOf(member)}`,
		{ data: { role }, headers: { origin: owner.origin } },
	);
	await expectOk(response);
}

export async function removeMember(owner: Person, documentId: string, member: Person) {
	const response = await owner.request.delete(
		`/api/documents/${documentId}/members/${await userIdOf(member)}`,
		{ headers: { origin: owner.origin } },
	);
	await expectOk(response);
}

export async function deleteDocument(owner: Person, documentId: string) {
	const response = await owner.request.delete(`/api/documents/${documentId}`, {
		headers: { origin: owner.origin },
	});
	await expectOk(response);
}
