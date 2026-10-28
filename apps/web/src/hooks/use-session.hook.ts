import { useRouteLoaderData } from 'react-router';

import type { sessionLoader } from '@/loaders/session.loader';

export const useSession = () => useRouteLoaderData<typeof sessionLoader>('root') ?? null;

export const useIsGuest = () => useSession()?.user.isAnonymous ?? false;

export const useAuthenticatedSession = () => {
	const session = useSession();

	if (!session) {
		throw new Error('useAuthenticatedSession must be used inside <AuthGuard />');
	}

	return session;
};
