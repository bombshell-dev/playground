export class Node {
	readonly parent?: Node;
	readonly children: Set<Node>;

	contexts?: Map<string, unknown>;

	constructor(parent?: Node) {
		this.parent = parent;
		this.children = new Set();
	}
}
