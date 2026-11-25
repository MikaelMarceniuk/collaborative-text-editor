import { sendEmail } from '../config/mailer.js';
import type { DocumentRole } from '../models/document.model.js';

interface ShareDocumentEmailInput {
	to: string;
	name: string;
	inviterName: string;
	documentTitle: string;
	documentUrl: string;
	role: Exclude<DocumentRole, 'owner'>;
}

const ROLE_DESCRIPTIONS = {
	editor: 'edit',
	viewer: 'view',
} as const;

const escapeHtml = (value: string) =>
	value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;');

// Names and titles are free text typed by users: keep them on a single line in the subject
const singleLine = (value: string) => value.replaceAll(/\s+/g, ' ').trim();

export function sendShareDocumentEmail({
	to,
	name,
	inviterName,
	documentTitle,
	documentUrl,
	role,
}: ShareDocumentEmailInput) {
	const action = ROLE_DESCRIPTIONS[role];
	const safeName = escapeHtml(name);
	const safeInviter = escapeHtml(inviterName);
	const safeTitle = escapeHtml(documentTitle);
	const safeUrl = escapeHtml(documentUrl);

	return sendEmail({
		to,
		subject: `${singleLine(inviterName)} shared "${singleLine(documentTitle)}" with you`,
		text: `Hi ${name},\n\n${inviterName} shared the document "${documentTitle}" with you. You can ${action} it:\n${documentUrl}`,
		html: `
			<div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto; color: #0a0a0a;">
				<h1 style="font-size: 20px;">A document was shared with you</h1>
				<p>Hi ${safeName},</p>
				<p><strong>${safeInviter}</strong> shared <strong>${safeTitle}</strong> with you. You can ${action} it.</p>
				<p>
					<a href="${safeUrl}" style="display: inline-block; padding: 10px 16px; border-radius: 6px; background: #171717; color: #fafafa; text-decoration: none;">
						Open document
					</a>
				</p>
			</div>
		`,
	});
}
