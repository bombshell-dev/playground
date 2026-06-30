// oxlint-disable bombshell-dev/no-generic-error
import type { Node } from "./types.ts";
import { NodeApi } from "./node.ts";

function findRoot(node: Node): Node {
  let n = node;
  while (n.parent) {
    n = n.parent;
  }
  return n;
}

function focusChain(node: Node): Node[] {
  const result: Node[] = [];
  if ("focused" in node.props) {
    result.push(node);
  }
  for (const child of node.children) {
    result.push(...focusChain(child));
  }
  return result;
}

function successorOf(node: Node): Node | undefined {
  const nodes = focusChain(findRoot(node));
  if (nodes.length <= 1) {
    return undefined;
  }
  const idx = nodes.indexOf(node);
  if (idx === -1) {
    return undefined;
  }
  return nodes[(idx + 1) % nodes.length];
}

export function focusable(node: Node): void {
  if (!("focused" in node.props)) {
    node.set("focused", false);
  }
}

export function current(node: Node): Node {
  const root = findRoot(node);
  return focusChain(root).find((n) => n.props.focused === true) ?? root;
}

export function advance(node: Node): void {
  const nodes = focusChain(findRoot(node));
  if (nodes.length <= 1) {
    return;
  }
  const idx = nodes.findIndex((n) => n.props.focused === true);
  if (idx === -1) {
    return;
  }
  nodes[idx].set("focused", false);
  nodes[(idx + 1) % nodes.length].set("focused", true);
}

export function retreat(node: Node): void {
  const nodes = focusChain(findRoot(node));
  if (nodes.length <= 1) {
    return;
  }
  const idx = nodes.findIndex((n) => n.props.focused === true);
  if (idx === -1) {
    return;
  }
  nodes[idx].set("focused", false);
  nodes[(idx - 1 + nodes.length) % nodes.length].set("focused", true);
}

export function focus(target: Node): void {
  if (!("focused" in target.props)) {
    throw new Error("Cannot focus a non-focusable node");
  }
  if (target.props.focused === true) {
    return;
  }
  const old = focusChain(findRoot(target)).find((n) => n.props.focused === true);
  if (old) {
    old.set("focused", false);
  }
  target.set("focused", true);
}

export function useFocus(node: Node): void {
  const first = focusChain(node).find((n) => n !== node);
  if (first) {
    focus(first);
  }
  node.scope.around(NodeApi, {
    remove([target], next) {
      if (target.props.focused === true) {
        const successor = successorOf(target);
        if (successor && successor !== target) {
          focus(successor);
        }
      }
      return next(target);
    },
  });
}
