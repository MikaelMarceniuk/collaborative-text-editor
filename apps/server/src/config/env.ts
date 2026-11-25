import { z } from 'zod';

const envSchema = z
	.object({
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

		// Optional only in development, where emails are logged to the console instead of sent
		RESEND_API_KEY: z.preprocess(
			(value) => (value === '' ? undefined : value),
			z.string().startsWith('re_').optional(),
		),
		MAIL_FROM: z.string().default('Collaborative Editor <onboarding@resend.dev>'),

		WEB_URL: z.url().default('http://localhost:5173'),
	})
	.superRefine((data, ctx) => {
		if (data.NODE_ENV !== 'development' && !data.RESEND_API_KEY) {
			ctx.addIssue({
				code: 'custom',
				path: ['RESEND_API_KEY'],
				message: 'Required when NODE_ENV is not "development"',
			});
		}
	});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
	console.error('Invalid environment variables:\n' + z.prettifyError(parsed.error));
	process.exit(1);
}

export const env = parsed.data;
