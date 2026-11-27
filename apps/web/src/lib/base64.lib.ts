/** The server sends binary inside JSON as base64 (see docs/versions.md). */
export const base64ToBytes = (base64: string) =>
	Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
