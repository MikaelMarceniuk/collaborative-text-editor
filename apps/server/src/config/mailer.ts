import { Resend } from 'resend';

import { env } from './env.js';

const resend = env.RESEND_API_KEY ? new Resend(env.RESEND_API_KEY) : null;

interface SendEmailInput {
	to: string;
	subject: string;
	html: string;
	text: string;
}

export async function sendEmail({ to, subject, html, text }: SendEmailInput) {
	if (!resend) {
		// Only reachable in development (see env.ts): print the email so links can be clicked from the terminal
		console.info(
			`\n[mailer] RESEND_API_KEY not set, email not sent.\nTo: ${to}\nSubject: ${subject}\n\n${text}\n`,
		);
		return;
	}

	const { error } = await resend.emails.send({ from: env.MAIL_FROM, to, subject, html, text });

	if (error) {
		throw new Error(`Could not send email "${subject}": ${error.message}`);
	}
}
