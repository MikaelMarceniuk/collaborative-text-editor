import { Resend } from 'resend';

import { env } from './env.js';

const resend = new Resend(env.RESEND_API_KEY);

interface SendEmailInput {
	to: string;
	subject: string;
	html: string;
	text: string;
}

export async function sendEmail({ to, subject, html, text }: SendEmailInput) {
	const { error } = await resend.emails.send({ from: env.MAIL_FROM, to, subject, html, text });

	if (error) {
		throw new Error(`Could not send email "${subject}": ${error.message}`);
	}
}
