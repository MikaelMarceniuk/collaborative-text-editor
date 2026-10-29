import { anonymousClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';

export const authClient = createAuthClient({
	plugins: [anonymousClient()],
	baseURL: `${window.location.origin}/api/auth`,
});

export const EMAIL_VERIFICATION_CALLBACK_URL = `${window.location.origin}/verify-email`;
