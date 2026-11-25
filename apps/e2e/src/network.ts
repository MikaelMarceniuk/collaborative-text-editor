import type { Page } from '@playwright/test';

type PageWithSockets = typeof globalThis & { documentSockets: WebSocket[] };

/**
 * A way to cut the document socket of one page and keep it cut until it is turned back on.
 *
 * `context.setOffline()` alone is not enough: the Chromium emulation only blocks new connections and
 * leaves the open WebSocket alone. So the page keeps track of its document sockets, and going offline
 * closes them (first) AND blocks the new ones, which then fail the way an unreachable server does (a connection
 * error, which the Socket.IO client retries). Answering the retries with an open-and-close instead, as
 * `routeWebSocket` would, leaves the client waiting for a handshake that never comes, and it stops
 * trying to reconnect.
 *
 * Install it BEFORE the page opens the document (the sockets are tracked from then on).
 */
export async function installSocketSwitch(page: Page) {
	await page.addInitScript(() => {
		const NativeWebSocket = globalThis.WebSocket;
		const sockets: WebSocket[] = [];
		(globalThis as PageWithSockets).documentSockets = sockets;

		globalThis.WebSocket = class extends NativeWebSocket {
			constructor(url: string | URL, protocols?: string | string[]) {
				super(url, protocols);
				// Only the document socket: the Vite HMR one is left alone
				if (String(url).includes('/api/socket.io/')) sockets.push(this);
			}
		};
	});

	return {
		async goOffline() {
			// Close first: a WebSocket only fires "close" after the closing handshake with the server, which
			// cannot finish once the network is cut. The first reconnection attempt comes at least ~0.5s later
			await page.evaluate(() => {
				for (const socket of (globalThis as PageWithSockets).documentSockets) socket.close();
			});
			await page.context().setOffline(true);
		},
		async goOnline() {
			await page.context().setOffline(false);
		},
	};
}
