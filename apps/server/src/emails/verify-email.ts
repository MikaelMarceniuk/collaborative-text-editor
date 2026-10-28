import { sendEmail } from '../config/mailer.js';

interface VerifyEmailInput {
	to: string;
	name: string;
	url: string;
}

const escapeHtml = (value: string) =>
	value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;');

export function sendVerifyEmail({ to, name, url }: VerifyEmailInput) {
	const safeName = escapeHtml(name);
	const safeUrl = escapeHtml(url);

	return sendEmail({
		to,
		subject: 'Verify your email',
		text: `Hi ${name},\n\nConfirm your email to finish creating your account:\n${url}\n\nThis link expires in 1 hour. If you didn't sign up, you can ignore this email.`,
		html: `
			<div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto; color: #0a0a0a;">
				<h1 style="font-size: 20px;">Verify your email</h1>
				<p>Hi ${safeName},</p>
				<p>Confirm your email to finish creating your account.</p>
				<p>
					<a href="${safeUrl}" style="display: inline-block; padding: 10px 16px; border-radius: 6px; background: #171717; color: #fafafa; text-decoration: none;">
						Verify email
					</a>
				</p>
				<p style="font-size: 13px; color: #737373;">
					This link expires in 1 hour. If you didn't sign up, you can ignore this email.
				</p>
			</div>
		`,
	});
}
