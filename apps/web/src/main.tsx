import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';

import './index.css';
import { AuthGuard } from './components/guards/auth.guard';
import { GuestGuard } from './components/guards/guest.guard';
import { SessionFallback } from './components/session-fallback';
import { Toaster } from './components/ui/toast';
import { sessionLoader } from './loaders/session.loader';
import { RootPage } from './pages/root.page';
import { SignInPage } from './pages/sign-in.page';

const router = createBrowserRouter([
	{
		id: 'root',
		loader: sessionLoader,
		HydrateFallback: SessionFallback,
		children: [
			{ element: <AuthGuard />, children: [{ path: '/', element: <RootPage /> }] },
			{ element: <GuestGuard />, children: [{ path: '/sign-in', element: <SignInPage /> }] },
		],
	},
]);

createRoot(document.getElementById('root')!).render(
	<StrictMode>
		<Toaster />
		<RouterProvider router={router} />
	</StrictMode>,
);
