import { IconLogout } from '@tabler/icons-react';

import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';
import { useSession } from '@/hooks/use-session.hook';
import { useSignOut } from '@/hooks/use-sign-out.hook';

type InfoListProps = { title: string; items: [string, React.ReactNode][] };

const InfoList: React.FC<InfoListProps> = ({ title, items }) => (
	<section className="flex flex-col gap-3 rounded-lg border p-4">
		<h2 className="font-semibold">{title}</h2>
		<dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
			{items.map(([label, value]) => (
				<div key={label} className="contents">
					<dt className="text-muted-foreground">{label}</dt>
					<dd className="break-all">{value ?? '—'}</dd>
				</div>
			))}
		</dl>
	</section>
);

export const RootPage = () => {
	const { user, session } = useSession()!;
	const { handleSignOut, isSignOutPending } = useSignOut();

	return (
		<div className="flex min-h-svh items-center justify-center p-6 md:p-10">
			<div className="flex w-full max-w-md flex-col gap-4">
				<div className="flex items-center gap-2">
					<h1 className="text-2xl font-bold">Welcome{user.name ? `, ${user.name}` : ''}</h1>
					{user.isAnonymous && (
						<span className="rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
							Guest
						</span>
					)}
					<div className="ml-auto">
						<ThemeToggle />
					</div>
				</div>

				<InfoList
					title="User"
					items={[
						['Name', user.name],
						['Email', user.email],
						['ID', user.id],
					]}
				/>

				<InfoList
					title="Session"
					items={[
						['ID', session.id],
						['Created at', new Date(session.createdAt).toLocaleString()],
						['Expires at', new Date(session.expiresAt).toLocaleString()],
						['IP address', session.ipAddress],
						['User agent', session.userAgent],
					]}
				/>

				<Button variant="outline" disabled={isSignOutPending} onClick={handleSignOut}>
					<IconLogout />
					Sign out
				</Button>
			</div>
		</div>
	);
};
