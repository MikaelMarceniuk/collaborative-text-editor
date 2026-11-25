import { randomUUID } from 'node:crypto';

import { expect, test } from '@playwright/test';

import { password } from '../src/env.ts';
import { markEmailVerified } from '../src/mongo.ts';

test('signs up, verifies the email and signs in', async ({ page }) => {
	const email = `carol-${randomUUID().slice(0, 8)}@e2e.test`;

	await page.goto('/sign-up');
	await page.getByLabel('Name').fill('Carol');
	await page.getByLabel('Email').fill(email);
	await page.getByLabel('Password', { exact: true }).fill(password);
	await page.getByLabel('Confirm password').fill(password);
	await page.getByRole('button', { name: /create account|sign up/i }).click();

	await expect(page.getByRole('heading', { name: /check your email/i })).toBeVisible();
	await expect(page.getByText(email)).toBeVisible();

	// Without the verification, the sign-in is refused: the e-mail link is what lets the person in
	await markEmailVerified(email);

	await page.goto('/sign-in');
	await page.getByLabel('Email').fill(email);
	await page.getByLabel('Password').fill(password);
	await page.getByRole('button', { name: 'Login' }).click();

	await expect(page.getByRole('button', { name: 'New', exact: true })).toBeVisible();
});

test('a guest can write, but has to create an account to share', async ({ page }) => {
	await page.goto('/sign-in');
	await page.getByRole('button', { name: 'Continue as guest' }).click();

	await page.getByRole('button', { name: 'New', exact: true }).click();
	await expect(page.getByRole('textbox', { name: /Main content area/ })).toBeVisible();

	await page.getByRole('link', { name: 'Back to my documents' }).click();
	await page.getByRole('button', { name: 'Actions for Untitled document' }).click();
	await page.getByRole('menuitem', { name: 'Share' }).click();

	await expect(page.getByText('Create an account to share documents')).toBeVisible();
});
