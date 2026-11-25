import { describe, expect, it } from 'vitest';

import { collections } from '../config/mongodb.js';
import { createDocument, createUser } from '../test/helpers.js';
import { transferGuestDocuments } from './transfer-guest-documents.js';

describe('transferGuestDocuments', () => {
	it('moves the ownership and the membership of the guest to the account', async () => {
		const guest = await createUser({ isAnonymous: true });
		const account = await createUser();
		const document = await createDocument({ ownerId: guest.id });

		await transferGuestDocuments({
			guestUserId: guest.id.toHexString(),
			userId: account.id.toHexString(),
		});

		const saved = await collections.documents.findOne({ _id: document._id });
		expect(saved?.ownerId).toEqual(account.id);
		expect(saved?.members).toEqual([{ userId: account.id, role: 'owner' }]);
	});

	it('leaves the documents of other users alone', async () => {
		const guest = await createUser({ isAnonymous: true });
		const account = await createUser();
		const other = await createUser();
		const document = await createDocument({ ownerId: other.id });

		await transferGuestDocuments({
			guestUserId: guest.id.toHexString(),
			userId: account.id.toHexString(),
		});

		const saved = await collections.documents.findOne({ _id: document._id });
		expect(saved?.members).toEqual([{ userId: other.id, role: 'owner' }]);
	});

	// A guest cannot be invited and cannot share, so the account is never already a member
	// of a guest document. If that rule ever changes, this transfer would create duplicate members.
	it('does not create duplicate members when the account is not yet a member', async () => {
		const guest = await createUser({ isAnonymous: true });
		const account = await createUser();
		await createDocument({ ownerId: guest.id });

		await transferGuestDocuments({
			guestUserId: guest.id.toHexString(),
			userId: account.id.toHexString(),
		});

		const documents = await collections.documents.find({}).toArray();
		for (const document of documents) {
			const ids = document.members.map((member) => member.userId.toHexString());
			expect(new Set(ids).size).toBe(ids.length);
		}
	});
});
