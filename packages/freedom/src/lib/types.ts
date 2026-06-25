import type { Operation, Result, Stream } from "effection";

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type Component = () => Operation<void>;

export interface NodeDataKey<T> {
  readonly symbol: symbol;
  readonly defaultValue?: T;
}

export function createNodeData<T>(
  name: string,
  defaultValue?: T,
): NodeDataKey<T> {
  return { symbol: Symbol(name), defaultValue };
}

export interface NodeData {
  get<T>(key: NodeDataKey<T>): T | undefined;
  set<T>(key: NodeDataKey<T>, value: T): void;
  expect<T>(key: NodeDataKey<T>): T;
}

export interface Node {
  readonly id: string;
  readonly name: string;
  readonly props: Record<string, JsonValue>;
  readonly children: Iterable<Node>;
  readonly parent: Node | undefined;
  readonly data: NodeData;
  eval<T>(op: () => Operation<T>): Operation<Result<T>>;
  remove(): Operation<void>;
}

export interface Tree extends Stream<void, never> {
  dispatch(event: unknown): void;
  root: Node;
}
