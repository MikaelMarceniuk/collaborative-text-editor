import type { IncomingHttpHeaders } from 'node:http';

import { fromNodeHeaders } from 'better-auth/node';

import { auth } from '../config/better-auth.js';

/** The user behind the session cookie of a socket handshake, or null when there is no valid session. */
export const getSocketUser = async (headers: IncomingHttpHeaders) => {
	const result = await auth.api.getSession({ headers: fromNodeHeaders(headers) });

	return result ? { id: result.user.id } : null;
};
