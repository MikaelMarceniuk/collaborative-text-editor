import { authClient } from '@/lib/auth-client.lib';

export const sessionLoader = async () => {
	const { data } = await authClient.getSession();

	return data;
};
