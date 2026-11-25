import { randomUUID } from 'node:crypto';

import {
	test as base,
	type APIRequestContext,
	type BrowserContext,
	type Page,
} from '@playwright/test';

import { origins, password, type InstanceName } from './env.ts';
import { markEmailVerified } from './mongo.ts';

/** One signed-in person in a browser context of their own, on one of the two web origins. */
export interface Person {
	name: string;
	email: string;
	instance: InstanceName;
	origin: string;
	context: BrowserContext;
	page: Page;
	/** Shares the cookies of the context, so it is signed in as well. */
	request: APIRequestContext;
}

export interface TestOptions {
	/** The instance Bob uses: the same as Alice (one-instance) or the other one (two-instances). */
	bobInstance: InstanceName;
}

interface TestFixtures {
	makePerson: (name: string, instance?: InstanceName) => Promise<Person>;
	alice: Person;
	bob: Person;
}

export const test = base.extend<TestFixtures & TestOptions>({
	bobInstance: ['a', { option: true }],

	makePerson: async ({ browser }, use) => {
		const contexts: BrowserContext[] = [];

		await use(async (name, instance = 'a') => {
			const origin = origins[instance];
			const email = `${name.toLowerCase()}-${randomUUID().slice(0, 8)}@e2e.test`;
			const context = await browser.newContext({ baseURL: origin });
			contexts.push(context);

			// The Origin header is what the CSRF check of better-auth looks at
			const headers = { origin };

			const signUp = await context.request.post('/api/auth/sign-up/email', {
				data: { name, email, password },
				headers,
			});
			if (!signUp.ok())
				throw new Error(`Sign-up failed: ${signUp.status()} ${await signUp.text()}`);

			await markEmailVerified(email);

			const signIn = await context.request.post('/api/auth/sign-in/email', {
				data: { email, password },
				headers,
			});
			if (!signIn.ok())
				throw new Error(`Sign-in failed: ${signIn.status()} ${await signIn.text()}`);

			const page = await context.newPage();
			return { name, email, instance, origin, context, page, request: context.request };
		});

		await Promise.all(contexts.map((context) => context.close()));
	},

	alice: async ({ makePerson }, use) => {
		await use(await makePerson('Alice', 'a'));
	},

	bob: async ({ makePerson, bobInstance }, use) => {
		await use(await makePerson('Bob', bobInstance));
	},
});

export { expect } from '@playwright/test';
