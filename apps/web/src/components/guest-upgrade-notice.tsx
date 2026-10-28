import { formatGuestDocuments, useGuestDocumentCount } from '@/hooks/use-guest-document-count.hook';
import { useIsGuest } from '@/hooks/use-session.hook';

import { GuestNotice } from './guest-notice';

const WHAT_HAPPENS = {
	'sign-in': 'will be added to the account you sign in to.',
	'sign-up': 'will move to your new account once you verify your email.',
};

interface GuestUpgradeNoticeProps {
	flow: keyof typeof WHAT_HAPPENS;
}

export const GuestUpgradeNotice: React.FC<GuestUpgradeNoticeProps> = ({ flow }) => {
	const isGuest = useIsGuest();
	const documentCount = useGuestDocumentCount();

	if (!isGuest || documentCount === 0) return null;

	return (
		<GuestNotice>
			You&apos;re using a guest account. {formatGuestDocuments(documentCount)} {WHAT_HAPPENS[flow]}
		</GuestNotice>
	);
};
