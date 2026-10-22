// The demo document and its snapshot into `@bomb.sh/css` node form.
import { Document, type Element } from '@bomb.sh/dom';
import { NO_PARENT, type CssNode } from '@bomb.sh/css';
import { CELL_HEIGHT_PX, CELL_WIDTH_PX, type TerminalSize } from './index.ts';

/// WIT `node-state` flags in declaration order: focus, hover, active.
export const NODE_STATE = { focus: 1, hover: 2, active: 4 } as const;

export interface SnapshotOptions {
	/// Inline style for the root element (e.g. capability custom properties).
	rootStyle?: string;
	/// Recorded on the root node so container queries can size against the
	/// terminal viewport.
	viewport?: TerminalSize;
}

/// Snapshot a document into the flat, document-ordered node/parent form
/// `computeTree` consumes: `NO_PARENT` marks a root, sibling order follows
/// document order, and the focus flag reflects `document.activeElement`.
export function snapshotDocument(
	document: Document,
	options: SnapshotOptions = {},
): { nodes: CssNode[]; parents: number[] } {
	const nodes: CssNode[] = [];
	const parents: number[] = [];
	const visit = (element: Element, parent: number): void => {
		const index = nodes.length;
		const isRoot = parent === NO_PARENT;
		nodes.push({
			tag: element.localName,
			id: element.id === '' ? undefined : element.id,
			classes: element.className.split(/\s+/).filter(Boolean),
			attributes: Array.from(element.attributes, (attr): [string, string] => [
				attr.name,
				attr.value,
			]),
			state: document.activeElement === element ? NODE_STATE.focus : 0,
			width: isRoot && options.viewport ? options.viewport.columns * CELL_WIDTH_PX : undefined,
			height: isRoot && options.viewport ? options.viewport.rows * CELL_HEIGHT_PX : undefined,
			style:
				isRoot && options.rootStyle !== undefined
					? options.rootStyle
					: (element.getAttribute('style') ?? undefined),
		});
		parents.push(parent);
		for (const child of element.children) {
			visit(child, index);
		}
	};
	if (document.documentElement) {
		visit(document.documentElement, NO_PARENT);
	}
	return { nodes, parents };
}

const CARDS: [string, string][] = [
	['layout', 'One column below 80 columns, two above — @media (min-width: 80ch).'],
	['scheme', 'Colors come from light-dark(), resolved against the probed background.'],
	['motion', 'The host wires its own reduced-motion switch into the environment.'],
];

/// Build the demo document: a header plus a small board of cards.
export function createDemoDocument(): Document {
	const document = new Document();
	const app = document.createElement('box');
	app.id = 'app';
	app.className = 'app';

	const header = document.createElement('box');
	header.className = 'header';
	const title = document.createElement('text');
	title.className = 'title';
	title.textContent = 'bombshell css';
	const status = document.createElement('text');
	status.className = 'status';
	status.textContent = '@media over tty capabilities';
	header.append(title, status);

	const board = document.createElement('box');
	board.className = 'board';
	for (const [name, blurb] of CARDS) {
		const card = document.createElement('box');
		card.className = 'card';
		card.tabIndex = 0;
		const heading = document.createElement('text');
		heading.className = 'heading';
		heading.textContent = name;
		const body = document.createElement('text');
		body.className = 'body';
		body.textContent = blurb;
		card.append(heading, body);
		board.append(card);
	}

	app.append(header, board);
	document.append(app);
	return document;
}
