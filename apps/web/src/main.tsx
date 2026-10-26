import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';

import './index.css';
import { Toaster } from './components/ui/toast';
import { SignInPage } from './pages/sign-in.page';

const router = createBrowserRouter([{ path: '/sign-in', element: <SignInPage /> }]);

createRoot(document.getElementById('root')!).render(
	<StrictMode>
		<Toaster />
		<RouterProvider router={router} />
	</StrictMode>,
);
