import type { ObjectId } from 'mongodb';

/**
 * What the REST routes tell the realtime layer when someone's access to a document changes.
 * Every call emits "doc:access-changed" and then disconnects the affected sockets. The client reconnects, and the
 * handshake looks the role up again: the user comes back with the new role, or is told "not_found" if removed.
 * That way the role is never cached in a socket for longer than one connection (and it works across instances).
 */
export interface AccessNotifier {
	/** A member's role changed, or they were removed or left the document. */
	memberChanged(documentId: ObjectId, userId: ObjectId): Promise<void>;
	/** The document was deleted: everyone is disconnected and the room is dropped without saving. */
	documentDeleted(documentId: ObjectId): Promise<void>;
}

const noopNotifier: AccessNotifier = {
	memberChanged: async () => {},
	documentDeleted: async () => {},
};

let current = noopNotifier;

/** Set by the socket server when it starts. Until then (and in route tests) the calls do nothing. */
export const setAccessNotifier = (notifier: AccessNotifier) => {
	current = notifier;
};

export const resetAccessNotifier = () => {
	current = noopNotifier;
};

export const accessNotifier: AccessNotifier = {
	memberChanged: (documentId, userId) => current.memberChanged(documentId, userId),
	documentDeleted: (documentId) => current.documentDeleted(documentId),
};
