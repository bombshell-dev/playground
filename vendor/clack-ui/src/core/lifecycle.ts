import { Node } from './node.ts';
import { createApi } from './api.ts';
import { createContext } from './context.ts';

export const LifecycleApi = createApi('lifecycle', {
	create(parent) {
		const ids = Ids.expect(parent);
		const node = new Node(parent);
		parent.children.add(node);
		IdContext.set(node, `${ids.latest++}`);
		return node;
	},
	destroy(node) {
		for (const child of node.children) {
			destroy(child);
		}
		node.parent?.children.delete(node);
	},
	id(node) {
		return IdContext.expect(node);
	},
});

export const { destroy, id } = LifecycleApi.methods;

export function create(parent: Node = global) {
	return LifecycleApi.methods.create(parent);
}

const IdContext = createContext<string>('id');
const Ids = createContext<{ latest: number }>('@ids');

const global = new Node();

IdContext.set(global, 'root');
Ids.set(global, { latest: 0 });
