import { fromNodeHeaders } from 'better-auth/node';
import type { RequestHandler } from 'express';

import { auth } from '../../config/better-auth.js';

type AuthSession = typeof auth.$Infer.Session;

declare global {
	namespace Express {
		interface Locals {
			session: AuthSession['session'];
			user: AuthSession['user'];
		}
	}
}

export const authMiddleware: RequestHandler = async (req, res, next) => {
	const result = await auth.api.getSession({
		headers: fromNodeHeaders(req.headers),
	});

	if (!result) {
		res.status(401).json({ error: 'Unauthorized' });
		return;
	}

	res.locals.session = result.session;
	res.locals.user = result.user;

	next();
};
