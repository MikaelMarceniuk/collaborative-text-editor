import { z } from 'zod';

const envSchema = z.object({
	NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
	PORT: z.coerce.number().int().positive().default(3333),

	MONGO_URL: z
		.string()
		.regex(
			/^mongodb(\+srv)?:\/\/[^/]+\/[^/?]+/,
			'Must be a mongodb URL including the database name',
		),

	BETTER_AUTH_SECRET: z.string().min(32),
	BETTER_AUTH_URL: z.url(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
	console.error('Invalid environment variables:\n' + z.prettifyError(parsed.error));
	process.exit(1);
}

export const env = parsed.data;
