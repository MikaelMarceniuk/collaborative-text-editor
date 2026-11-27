import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { CONTENT_FIELD } from './document-content.service.js';
import { replaceContent } from './replace-content.js';

const paragraph = (text: string) => {
	const element = new Y.XmlElement('paragraph');
	element.insert(0, [new Y.XmlText(text)]);
	return element;
};

const stateOf = (nodes: (Y.XmlElement | Y.XmlText)[]) => {
	const ydoc = new Y.Doc();
	ydoc.getXmlFragment(CONTENT_FIELD).insert(0, nodes);
	return Y.encodeStateAsUpdate(ydoc);
};

const contentOf = (ydoc: Y.Doc) => ydoc.getXmlFragment(CONTENT_FIELD).toString();

const docFrom = (state: Uint8Array) => {
	const ydoc = new Y.Doc();
	Y.applyUpdate(ydoc, state);
	return ydoc;
};

describe('replaceContent', () => {
	it('turns the current content into the content of the snapshot', () => {
		const old = stateOf([paragraph('the old text')]);
		const current = docFrom(stateOf([paragraph('something else'), paragraph('and more')]));

		replaceContent(current, old);

		expect(contentOf(current)).toBe(contentOf(docFrom(old)));
	});

	it('brings back the old content even though the current state contains it', () => {
		// The snapshot is an earlier state of the same document, which is what a version is
		const ydoc = new Y.Doc();
		ydoc.getXmlFragment(CONTENT_FIELD).insert(0, [paragraph('first draft')]);
		const snapshot = Y.encodeStateAsUpdate(ydoc);
		ydoc.getXmlFragment(CONTENT_FIELD).delete(0, 1);
		ydoc.getXmlFragment(CONTENT_FIELD).insert(0, [paragraph('second draft')]);

		// Applying the snapshot is a no-op, which is why the content has to be replaced
		Y.applyUpdate(ydoc, snapshot);
		expect(contentOf(ydoc)).toContain('second draft');

		replaceContent(ydoc, snapshot);

		expect(contentOf(ydoc)).toContain('first draft');
		expect(contentOf(ydoc)).not.toContain('second draft');
	});

	it('returns an update that makes another replica converge, and keeps nothing deleted alive', () => {
		const server = docFrom(stateOf([paragraph('current')]));
		// A client that has the current content, and applies what the server produces
		const client = docFrom(Y.encodeStateAsUpdate(server));
		const old = stateOf([paragraph('restored')]);

		const update = replaceContent(server, old);
		Y.applyUpdate(client, update!);

		expect(contentOf(client)).toBe(contentOf(server));
		expect(contentOf(client)).toContain('restored');
		expect(contentOf(client)).not.toContain('current');
	});

	it('does not bring the old content back from a client that was offline during the restore', () => {
		const server = docFrom(stateOf([paragraph('current')]));
		const offlineClient = docFrom(Y.encodeStateAsUpdate(server));

		const update = replaceContent(server, stateOf([paragraph('restored')]));

		// The client reconnects: it sends what the server is missing and receives what it is missing
		Y.applyUpdate(server, Y.encodeStateAsUpdate(offlineClient, Y.encodeStateVector(server)));
		Y.applyUpdate(offlineClient, update!);

		expect(contentOf(server)).toBe(contentOf(offlineClient));
		expect(contentOf(server)).not.toContain('current');
	});

	it('keeps the attributes of the elements and the formatting of the text', () => {
		const heading = new Y.XmlElement('heading');
		heading.setAttribute('level', '2');
		const text = new Y.XmlText();
		text.insert(0, 'bold', { bold: true });
		text.insert(4, ' plain');
		heading.insert(0, [text]);
		const old = stateOf([heading]);
		const current = docFrom(stateOf([paragraph('x')]));

		replaceContent(current, old);

		expect(contentOf(current)).toBe(contentOf(docFrom(old)));
		expect(contentOf(current)).toContain('level="2"');
		expect(contentOf(current)).toContain('<bold');
	});

	it('empties the content when the snapshot has none', () => {
		const current = docFrom(stateOf([paragraph('text')]));

		replaceContent(current, Y.encodeStateAsUpdate(new Y.Doc()));

		expect(current.getXmlFragment(CONTENT_FIELD).length).toBe(0);
	});

	it('keeps both replicas equal when another client edits during the restore', () => {
		const server = docFrom(stateOf([paragraph('current')]));
		const client = docFrom(Y.encodeStateAsUpdate(server));
		client.getXmlFragment(CONTENT_FIELD).insert(1, [paragraph('typed during the restore')]);

		const update = replaceContent(server, stateOf([paragraph('restored')]));
		Y.applyUpdate(server, Y.encodeStateAsUpdate(client, Y.encodeStateVector(server)));
		Y.applyUpdate(client, update!);

		// Both replicas agree, and the restored content is there
		expect(contentOf(server)).toBe(contentOf(client));
		expect(contentOf(server)).toContain('restored');
	});
});
