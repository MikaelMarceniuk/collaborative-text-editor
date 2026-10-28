import { Navigate, Outlet } from 'react-router';

import { useSession } from '@/hooks/use-session.hook';

export const AccountlessGuard = () => {
	const session = useSession();

	if (session && !session.user.isAnonymous) {
		return <Navigate to="/" replace />;
	}

	return <Outlet />;
};
