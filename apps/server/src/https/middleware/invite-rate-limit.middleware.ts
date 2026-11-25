import { rateLimit } from 'express-rate-limit';

export const MAX_INVITES_PER_HOUR = 20;

// Limits invites per user, not per IP: it makes email enumeration and invite spam expensive.
// The counter lives in memory, so with several server instances each one counts on its own
// (a shared Redis store comes with the Redis adapter).
// Needs authMiddleware before it.
export const inviteRateLimit = rateLimit({
	windowMs: 60 * 60 * 1000,
	limit: MAX_INVITES_PER_HOUR,
	standardHeaders: 'draft-8',
	legacyHeaders: false,
	keyGenerator: (_req, res) => res.locals.user.id,
	message: { error: 'Too many invites. Try again later' },
});
