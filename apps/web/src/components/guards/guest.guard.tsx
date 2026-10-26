import { Navigate, Outlet } from 'react-router';

import { useSession } from '@/hooks/use-session.hook';

export const GuestGuard = () => {
	const session = useSession();

	if (session) {
		return <Navigate to="/" replace />;
	}

	return <Outlet />;
};
