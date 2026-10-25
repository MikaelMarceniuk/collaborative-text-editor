import express from 'express';

import { healthRouter } from './https/routes/health.js';

export const app = express();

app.use(express.json());

app.use(healthRouter);
