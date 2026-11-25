import path from 'node:path';

import babel from '@rolldown/plugin-babel';
import tailwindcss from '@tailwindcss/vite';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// https://vite.dev/config/
export default defineConfig({
	plugins: [react(), babel({ presets: [reactCompilerPreset()] }), tailwindcss()],
	resolve: {
		alias: {
			'@': path.resolve(import.meta.dirname, './src'),
		},
		dedupe: ['yjs'],
	},
	server: {
		proxy: {
			// ws: true also proxies the document sockets (/api/socket.io)
			// API_URL lets the E2E point each web instance at its own server (see docs/e2e.md)
			'/api': { target: process.env.API_URL ?? 'http://localhost:3333', ws: true },
		},
	},
});
