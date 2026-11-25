import type { DocumentRole } from '@/hooks/use-documents.hook';

export const ROLE_LABELS: Record<DocumentRole, string> = {
	owner: 'Owner',
	editor: 'Can edit',
	viewer: 'View only',
};
