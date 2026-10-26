import { toNodeHandler } from 'better-auth/node';
import express from 'express';

import { auth } from './config/better-auth.js';
import { corsConfig } from './config/cors.js';
import { healthRouter } from './https/routes/health.js';

export const app = express();

app.all('/api/auth/{*any}', toNodeHandler(auth));

app.use(corsConfig);
app.use(express.json());

app.use(healthRouter);
