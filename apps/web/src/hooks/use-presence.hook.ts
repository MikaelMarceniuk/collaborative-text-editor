import { useMemo, useSyncExternalStore } from 'react';
import type { Awareness } from 'y-protocols/awareness';

import type { PresenceUser } from '@/lib/presence.lib';

const isPresenceUser = (value: unknown): value is PresenceUser => {
	if (typeof value !== 'object' || value === null) return false;
	const { id, name, color } = value as Partial<PresenceUser>;
	return typeof id === 'string' && typeof name === 'string' && typeof color === 'string';
};

// A string, so React can tell by value whether the people changed: a cursor moving changes the Awareness
// on every key, but not who is in the document
const readPeople = (awareness: Awareness, selfId: string) => {
	const people = new Map<string, PresenceUser>();

	for (const [clientId, state] of awareness.getStates()) {
		const user: unknown = state.user;
		if (clientId === awareness.clientID || !isPresenceUser(user) || user.id === selfId) continue;
		// The same person in two tabs is one person
		people.set(user.id, { id: user.id, name: user.name, color: user.color });
	}

	return JSON.stringify([...people.values()].sort((a, b) => a.name.localeCompare(b.name)));
};

/** The other people in the document right now, one entry per person even with several tabs open. */
export const usePresence = (awareness: Awareness, selfId: string): PresenceUser[] => {
	const snapshot = useSyncExternalStore(
		(onChange) => {
			awareness.on('change', onChange);
			return () => awareness.off('change', onChange);
		},
		() => readPeople(awareness, selfId),
	);

	return useMemo(() => JSON.parse(snapshot) as PresenceUser[], [snapshot]);
};
