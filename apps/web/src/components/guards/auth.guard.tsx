import { Navigate, Outlet } from 'react-router';

import { useSession } from '@/hooks/use-session.hook';

export const AuthGuard = () => {
	const session = useSession();

	if (!session) {
		return <Navigate to="/sign-in" replace />;
	}

	return <Outlet />;
};
