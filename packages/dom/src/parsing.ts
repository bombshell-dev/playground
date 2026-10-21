/* oxlint-disable bombshell-dev/exported-function-async -- Parser installation is deliberately synchronous. */
import { parseFragment, defaultTreeAdapter, html, type DefaultTreeAdapterMap } from 'parse5';
import { enqueueUpgrade, flushReactions } from './custom-elements.ts';
import {
	type Document,
	Element,
	Attr,
	Text,
	Comment,
	HTMLTemplateElement,
	type Node,
	type ShadowRoot,
} from './dom.ts';

type ParsedNode = DefaultTreeAdapterMap['childNode'];
function convert(node: ParsedNode, document: Document): Node | null {
	if (defaultTreeAdapter.isTextNode(node)) return document.createTextNode(node.value);
	if (defaultTreeAdapter.isCommentNode(node)) return document.createComment(node.data);
	if (!defaultTreeAdapter.isElementNode(node)) return null;
	const customCandidate = node.namespaceURI === html.NS.HTML && node.tagName.includes('-');
	const element = customCandidate
		? new Element(node.tagName, document)
		: document.createElementNS(node.namespaceURI, node.tagName);
	if (customCandidate && document.customElements.get(node.tagName)) enqueueUpgrade(element);
	for (const parsed of node.attrs) {
		const attr = new Attr(parsed.name, document, {
			namespaceURI: parsed.namespace ?? null,
			prefix: parsed.prefix ?? null,
		});
		attr.value = parsed.value;
		element.setAttributeNodeNS(attr);
	}
	const destination = element instanceof HTMLTemplateElement ? element.content : element;
	const source =
		node.tagName === 'template' && 'content' in node ? node.content.childNodes : node.childNodes;
	for (const child of source) {
		const result = convert(child, destination.ownerDocument ?? document);
		if (result) destination.appendChild(result);
	}
	return element;
}
function escapeText(value: string): string {
	return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}
const voidElements = new Set([
	'area',
	'base',
	'br',
	'col',
	'embed',
	'hr',
	'img',
	'input',
	'link',
	'meta',
	'param',
	'source',
	'track',
	'wbr',
]);
function serializeNode(node: Node): string {
	if (node instanceof Text) return escapeText(node.data);
	if (node instanceof Comment) return `<!--${node.data}-->`;
	if (!(node instanceof Element)) return serializeChildren(node);
	const name = node.prefix ? `${node.prefix}:${node.localName}` : node.localName;
	const attrs = node.attributes
		.map(
			(attr) => ` ${attr.name}="${attr.value.replaceAll('&', '&amp;').replaceAll('"', '&quot;')}"`,
		)
		.join('');
	const opening = `<${name}${attrs}>`;
	if (node.namespaceURI === 'http://www.w3.org/1999/xhtml' && voidElements.has(name))
		return opening;
	return `${opening}${serializeChildren(node instanceof HTMLTemplateElement ? node.content : node)}</${name}>`;
}
function serializeChildren(node: Node): string {
	return node.childNodes.map(serializeNode).join('');
}
/** Install opt-in HTML parsing backed by parse5. Scripts remain inert. */
export function installParsing(document: Document): void {
	document.setMarkupParser({
		parse(context: Element | ShadowRoot, markup: string) {
			const element = context instanceof Element ? context : context.host;
			const astContext = defaultTreeAdapter.createElement(
				element.localName,
				element.namespaceURI === 'http://www.w3.org/2000/svg'
					? html.NS.SVG
					: element.namespaceURI === 'http://www.w3.org/1998/Math/MathML'
						? html.NS.MATHML
						: html.NS.HTML,
				[],
			);
			const parsed = parseFragment(astContext, markup, {});
			const owner =
				context instanceof HTMLTemplateElement
					? (context.content.ownerDocument ?? document)
					: document;
			const fragment = owner.createDocumentFragment();
			for (const child of parsed.childNodes) {
				const node = convert(child, owner);
				if (node) fragment.appendChild(node);
			}
			flushReactions();
			return fragment;
		},
		serialize: serializeChildren,
	});
}
