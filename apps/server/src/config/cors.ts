import cors from 'cors';

import { env } from './env.js';

export const corsConfig = cors({
	origin: env.WEB_URL,
	credentials: true,
});
