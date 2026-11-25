import type { IncomingHttpHeaders } from 'node:http';

// Replaces socket-session in tests, like mock-auth replaces authMiddleware: the user comes from the x-test-user-id header
export const getSocketUser = async (headers: IncomingHttpHeaders) => {
	const userId = headers['x-test-user-id'];

	return typeof userId === 'string' ? { id: userId } : null;
};
