import type { Page, WebSocketRoute } from '@playwright/test';

/**
 * A way to cut the document socket of one page and keep it cut. `context.setOffline()` is not enough:
 * the Chromium emulation only blocks new connections and leaves the open WebSocket alone.
 *
 * Install it BEFORE the page opens the document (only the sockets created afterwards are routed).
 * The Vite HMR socket is not touched: only the Socket.IO path is routed.
 */
export async function installSocketSwitch(page: Page) {
	let online = true;
	const open = new Set<{ page: WebSocketRoute; server: WebSocketRoute }>();

	await page.routeWebSocket(/\/api\/socket\.io\//, (route) => {
		// Reconnection attempts made while offline get a closed socket, like an unreachable server
		if (!online) {
			void route.close();
			return;
		}

		const connection = { page: route, server: route.connectToServer() };
		open.add(connection);
		route.onClose(() => open.delete(connection));
	});

	return {
		async goOffline() {
			online = false;
			await Promise.all(
				[...open].flatMap(({ page: route, server }) => [route.close(), server.close()]),
			);
		},
		goOnline() {
			online = true;
		},
	};
}
