# Freedom Specification

**Version:** 0.1 — Draft\
**Status:** Normative draft\
**Depends on:** Effection 4.1-alpha (`createApi`, `createContext`, `Signal`,
`Stream`, `resource`, `spawn`, `Result`)

---

## 1. Purpose

Freedom ("free DOM") is a general-purpose abstract component tree built on
Effection's structured concurrency. It maintains a tree of long-lived, stateful
component nodes where each node is an Effection resource with a scope, a
property bag, and ordered children.

The tree is a **bidirectional firehose**:

- **Input:** A synchronous `dispatch(event)` entry point accepts events of any
  shape at any rate.
- **Output:** A `Stream<void>` emits a notification after every mutation cycle,
  signaling renderers to walk the tree and rebuild output.

Freedom is renderer-agnostic. It has no opinion about what properties mean, what
events look like, or how output is produced. Renderers, event vocabularies, and
display systems are consumers that operate on the tree from the outside.

---

## 2. Design Philosophy

### 2.1 Renderer independence

Freedom provides structure, state, events, and change notification. It does not
provide layout, rendering, styling, or any visual vocabulary. A clayterm
renderer reads `node.props["clay"]`. A DOM renderer reads `node.props["html"]`.
Freedom does not know or care.

### 2.2 Event agnosticism

Freedom defines exactly one event operation: `dispatch(event: unknown)`. It does
not define keyboard events, mouse events, or any other vocabulary. Applications
and framework layers install middleware at the root scope to demux raw events
into their own typed APIs. This allows Freedom to serve DOM applications,
terminal applications, game engines, or any other event source without
modification.

### 2.3 Operations over methods

Node mutations (`set`, `update`) and structural operations (`append`, `remove`,
`sort`) are Effection context API operations, not methods on the Node object.
This makes them interceptable by middleware — a parent scope can wrap `set` to
validate, transform, log, or reject property changes in its subtree. The
component signature is `() => Operation<void>`; everything is accessed through
the ambient scope.

### 2.4 Orthogonal concerns

Identity, properties, and child ordering are fully independent:

- **Identity** is intrinsic (object reference) with a framework-assigned unique
  `id` for external use.
- **Properties** are a JSON-like bag with conventional namespacing.
- **Ordering** is a separate axis: insertion order by default, or a custom sort
  function owned by the parent.

### 2.5 Immediate-mode output

The output stream emits `void` — a pure notification that something changed.
Renderers walk the tree and read properties to produce output. This matches
immediate-mode rendering patterns (e.g., clayterm rebuilds `Op[]` every frame).
The JSON-like property constraint does not foreclose on richer change records in
the future.

### 2.6 Read-only Node surface

The `Node` object's data fields — `id`, `name`, `props`, `children`, `parent` —
are for reading only. All property and structural mutations go through the
`freedom:node` context API, which makes every mutation interceptable by
middleware. `Node` also exposes `eval()` for scoped operation execution and
`remove()` for lifecycle management. `remove()` is both a convenience method on
`Node` and a context API operation — the method delegates to the operation,
ensuring middleware always participates in teardown.

---

## 3. Terminology

**Tree.** The root resource that owns all component nodes. Externally it is an
event sink (`dispatch`) and a change source (`Stream<void>`). Internally it is
an Effection scope that contains the root node, the event loop, and the
notification mechanism.

**Node.** A long-lived Effection resource within the tree. Each node has a
framework-assigned unique `id`, an optional name, a property bag, an ordered
list of children, and a parent (except the root). A node's in-memory identity is
its object reference; its externalizable identity is its `id`. The Node's data
fields are read-only — all property mutations go through the context API. Each
node maintains an eval loop that accepts operations via `node.eval()`, enabling
scoped execution. `node.remove()` delegates to the `remove` context API
operation, which halts the node's scope and tears down all descendants.
Middleware on `remove` participates in teardown.

**Component.** A generator function of type `() => Operation<void>` that runs
within a node's Effection scope for the node's entire lifetime. Components
access node operations and event middleware through the ambient scope. A
component either does its initialization work and returns, or enters an infinite
loop that reacts to changes. In either case, the node remains alive — the node's
scope outlives the component generator.

**Property bag.** A `Record<string, JsonValue>` on each node. Properties are the
node's state AND its renderable description — they are the same thing.
Properties are namespaced by convention (e.g., `"clay"`, `"aria"`).

**JsonValue.** The set of permissible property values:
`string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }`.
No `undefined`. Properties are removed with `unset()`.

**Dispatch.** The synchronous entry point for events. `tree.dispatch(event)`
pushes an event into the tree's internal Signal. The event is then processed
operationally through middleware.

**Middleware.** An Effection `createApi` middleware function that intercepts an
operation. In Freedom, middleware is used for both event handling
(`dispatch.around(...)`) and property mutation interception
(`node.around(...)`).

**Demux.** Application-level middleware installed at the root scope that routes
raw `dispatch` events into typed, application-specific APIs. Demuxing is NOT a
Freedom concept — it is a pattern that applications implement.

**Notification.** A `void` emission on the tree's output stream indicating that
the tree may have changed. At most one notification is emitted per dispatch
cycle. A dispatch cycle that produces no property or structural changes MUST NOT
emit a notification.

---

## 4. JsonValue

### 4.1 Definition

```
JsonValue = string
          | number
          | boolean
          | null
          | JsonValue[]
          | { [key: string]: JsonValue }
```

### 4.2 Constraints

J1. `undefined` is NOT a valid JsonValue. Implementations MUST reject
`undefined` in `set()` and `update()`.

J2. `NaN`, `Infinity`, and `-Infinity` are NOT valid JsonValues. Implementations
MUST reject them.

J3. Functions, symbols, class instances, `Date`, `Map`, `Set`, `RegExp`, and
other non-JSON-serializable values are NOT valid JsonValues.

J4. Implementations SHOULD validate values at the `set()` and `update()`
boundary. Invalid values MUST NOT be stored in the property bag.

### 4.3 Rationale

The JsonValue constraint ensures properties are:

- serializable (devtools, snapshots, undo/redo),
- structurally comparable (deep equality is well-defined),
- diffable (for future change record support).

Application-level state that requires richer types (functions, class instances,
Dates) belongs in the component's generator scope as local variables, not in the
property bag.

---

## 5. Node

### 5.1 Structure

Each node has:

- **id** (`string`) — a unique, framework-assigned identifier. Stable for the
  node's lifetime. Used by renderers and external systems to reference the node
  (e.g., clayterm named elements, ARIA ids, devtools).
- **name** (`string`, optional) — a human-readable label. Defaults to `""`. Not
  required to be unique. Used for debugging and optional lookup.
- **props** (`Record<string, JsonValue>`) — the property bag. Initially empty.
  Read-only; mutate via context API only.
- **children** (`Iterable<Node>`) — ordered child nodes. Initially empty.
  Read-only.
- **parent** (`Node | undefined`) — the parent node. The root node's parent is
  `undefined`. Read-only.

```ts
interface Node {
  readonly id: string;
  readonly name: string;
  readonly props: Record<string, JsonValue>;
  readonly children: Iterable<Node>;
  readonly parent: Node | undefined;
  readonly data: NodeData;
  eval<T>(op: () => Operation<T>): Operation<Result<T>>;
  remove(): Operation<void>;
}
```

The Node's data fields are read-only. All property and structural mutations go
through the `freedom:node` context API (§6). `eval` is a method on Node because
it requires a specific node reference. `remove` is both a method and a context
API operation — the method delegates to the operation (§6.2), ensuring
middleware participates in teardown. `data` provides typed, symbol-keyed storage
for private, non-serializable per-node state (§5.7).

### 5.2 Identity

N1. A node's in-memory identity is its object reference. Two nodes are the same
node if and only if they are the same object (`===`).

N2. Each node has a unique `id` string assigned by the framework at creation
time. The `id` is immutable — it MUST NOT change for the node's lifetime. The
`id` MUST be unique across all nodes in the tree at any given time. Two nodes
are the same node if and only if `a.id === b.id`.

N3. The `id` is the externalizable identity. Renderers and external systems use
it to correlate nodes across render cycles, reference nodes in output (e.g.,
named elements in clayterm), and track nodes in devtools.

N4. The format of `id` is implementation-defined. It MAY be a monotonic counter,
a UUID, or any other scheme that guarantees uniqueness within the tree.

N5. Nodes are long-lived Effection resources. A node is created once and exists
until explicitly removed or its parent scope exits.

N6. The `name` field is informational. It does NOT participate in identity,
uniqueness, or reconciliation.

### 5.3 Scoped Evaluation

Each node maintains an **eval loop** — a spawned child task within the node's
scope that accepts and executes operations submitted via `node.eval()`. The eval
loop uses a channel- based "fire and await" pattern: the caller submits an
operation and waits for its result; the eval loop executes the operation in the
node's scope and resolves the result.

N-eval1. `node.eval(op)` runs `op` within the node's Effection scope and returns
`Result<T>`. If `op` completes successfully, the result is
`{ ok: true, value: T }`. If `op` throws, the result is `{ ok: false, error }`.

N-eval2. Operations yielded inside `op` see the node's scope context — including
all middleware installed in the node's scope and its ancestors.

N-eval3. The eval loop executes operations sequentially. If multiple callers
submit operations concurrently, they are processed in order.

N-eval4. The eval loop is spawned as a child of the node's scope. It runs
alongside the component and shares the same parent scope, so middleware
installed by the component is visible to operations executed via `eval`.

### 5.4 Lifecycle

N7. A node is created by `append()`, which spawns a new Effection child scope
within the parent node's scope and runs the component within it.

N8. A node is destroyed by `node.remove()`, which halts the node's spawned task.
This triggers structured teardown of the component, the eval loop, all
middleware installed in the scope, and all descendant nodes. `remove()` does not
return until teardown is complete.

N9. When a node is destroyed, its middleware disappears automatically because
the Effection scope is destroyed.

N10. When a parent node is destroyed, all child nodes are destroyed in reverse
creation order (LIFO), per Effection's structured concurrency guarantees.

N11. `node.remove()` delegates to the `remove` context API operation (§6.2) via
`yield* node.eval(() => remove(node))`. The `remove` operation runs inside the
node's scope, and all middleware on `remove` participates in the teardown (outer
to inner). The innermost implementation halts the scope from within. The method
remains on `Node` for ergonomic use by parents: `yield* child.remove()`.

N12. Calling `remove()` on the root node is an error (C-rm3).

### 5.5 Property Bag

N13. Properties are accessed via `node.props`, which returns a read-only
`Record<string, JsonValue>`. Implementations SHOULD return a frozen or proxied
object to enforce read-only access at runtime.

N14. Properties MUST NOT be mutated by direct assignment to the `props` object.
The ONLY way to modify properties is through the `freedom:node` context API
operations (`set`, `update`, `unset`). See §6.

N15. The `props` object MUST reflect the latest state at all times. There is no
staleness window.

N16. Properties are namespaced by convention. Top-level keys (e.g., `"clay"`,
`"aria"`, `"app"`) serve as namespaces. Freedom does not enforce or validate
namespaces.

### 5.6 Children and Ordering

N17. Children are ordered. The default ordering is **insertion order** —
children appear in the order they were appended.

N18. A parent MAY install a **sort function** via the `sort` context API
operation. When a sort function is active, iterating `node.children` applies the
sort function to produce the ordering. Insertion order serves as tiebreaker for
children that compare equal.

N19. A parent MAY clear the sort function via `sort(undefined)`, which reverts
to insertion order.

N20. The sort function is applied at **read time** — when `node.children` is
iterated. There is no eager re-sorting on property changes. The sort is always
fresh because it runs against current property values at iteration time.

N21. Installing or clearing a sort function via `sort()` MUST emit a
notification (§8), because the iteration order of children may have changed.

### 5.7 Node Data

Node data is typed, symbol-keyed storage for non-serializable, private values
associated with a node. It exists to give extensions and middleware a place to
store per-node state that is invisible to other extensions, renderers, and
application code.

The property bag (§5.5) is the node's public, renderable state — constrained to
JsonValue, frozen, and observable via notifications. Node data is the
complement: private state owned by a specific extension, unconstrained in type,
and invisible to the rest of the system. Only code holding the key can read or
write the data. All NodeData operations are synchronous — no scope resolution is
needed because the node reference provides direct access to its data.

```ts
interface NodeDataKey<T> {
  readonly symbol: symbol;
  readonly defaultValue?: T;
}

interface NodeData {
  get<T>(key: NodeDataKey<T>): T | undefined;
  set<T>(key: NodeDataKey<T>, value: T): void;
  expect<T>(key: NodeDataKey<T>): T;
}

function createNodeData<T>(
  name: string,
  defaultValue?: T,
): NodeDataKey<T>;
```

D1. `createNodeData(name, defaultValue?)` creates a typed data key backed by a
`Symbol(name)`. The symbol ensures true privacy — only code holding the key can
access the data.

D2. `node.data.get(key)` returns the stored value, or `undefined` if no value
was set.

D3. `node.data.set(key, value)` stores a value on the node under the given key.

D4. `node.data.expect(key)` returns the stored value, or `defaultValue` if no
value was set. If neither exists, it throws an error.

D5. Node data does NOT trigger tree notifications. It is invisible to renderers.

The Node interface is extended:

```ts
interface Node {
  readonly id: string;
  readonly name: string;
  readonly props: Record<string, JsonValue>;
  readonly children: Iterable<Node>;
  readonly parent: Node | undefined;
  readonly data: NodeData;
  eval<T>(op: () => Operation<T>): Operation<Result<T>>;
  remove(): Operation<void>;
}
```

---

## 6. Node Context API

### 6.1 API Definition

The node context API is an Effection API created with `createApi`:

```
createApi("freedom:node", {
  *useNode(): Operation<Node>,
  *get(key: string): Operation<JsonValue | undefined>,
  *set(key: string, value: JsonValue): Operation<void>,
  *update(key: string, fn: (prev: JsonValue | undefined) => JsonValue): Operation<void>,
  *unset(key: string): Operation<void>,
  *append(name: string, component: Component): Operation<Node>,
  *remove(node: Node): Operation<void>,
  *sort(fn: ((a: Node, b: Node) => number) | undefined): Operation<void>,
})
```

Note: `node.remove()` is a convenience method that delegates to the `remove`
context API operation via `yield* node.eval(() => remove(node))`. This ensures
all middleware on `remove` participates in teardown.

### 6.2 Operations

**useNode**

C-node1. `useNode()` returns the current node from the ambient scope as a
`Node`.

C-node2. `useNode()` MUST be called within a node's scope (inside a component
body, middleware, or an `eval` call). If called outside a node scope, it MUST
raise an error.

C-node3. `useNode` is a `createApi` operation and can be intercepted by
middleware. A parent MAY install middleware on `useNode` to substitute a
different node reference (e.g., for virtualization or proxying).

**get**

C-get1. `get(key)` returns the value of `key` in the current node's property
bag, or `undefined` if the key does not exist.

C-get2. `get` is a `createApi` operation and can be intercepted by middleware. A
parent MAY install middleware on `get` to transform, log, or virtualize property
reads.

**set**

C1. `set(key, value)` stores `value` under `key` in the current node's property
bag.

C2. `value` MUST be a valid JsonValue (§4). If not, the operation MUST raise an
error.

C3. If `key` already exists, the previous value is replaced.

C4. `set` triggers a tree notification (§8).

**update**

C5. `update(key, fn)` calls `fn` with the current value of `key` (or `undefined`
if the key does not exist) and stores the result.

C6. The return value of `fn` MUST be a valid JsonValue (§4). If not, the
operation MUST raise an error.

C7. `update` triggers a tree notification (§8).

**unset**

C8. `unset(key)` removes `key` from the current node's property bag.

C9. If `key` does not exist, `unset` is a no-op. It MUST NOT raise an error.

C10. `unset` triggers a tree notification (§8) only if the key existed.

**append**

C11. `append(name, component)` creates a new child node with the given name,
spawns an Effection child scope, and runs the component within it.

C12. `append` returns the newly created Node.

C13. `append` triggers a tree notification (§8).

C14. The child node's scope is a child of the current node's scope. Middleware
installed in the child's scope inherits from the parent's scope per Effection's
context prototype chain.

**sort**

C19. `sort(fn)` installs a sort function on the current node. When `fn` is
defined, iterating this node's `children` applies `fn` to determine ordering.
When `fn` is `undefined`, the sort function is cleared and ordering reverts to
insertion order.

C20. `sort` triggers a tree notification (§8) (N19).

**remove**

C-rm1. `remove(node)` removes the given node. The innermost (default)
implementation halts the node's scope from within, triggering structured
teardown of the component, the eval loop, all middleware installed in the scope,
and all descendant nodes. The halt mechanism lives inside the scope (e.g., a
resolver the suspended task awaits) — the node does not hold a reference to its
task.

C-rm2. `remove(node)` is a `createApi` operation and can be intercepted by
middleware. Extensions (e.g., focus) MAY install middleware on `remove` to
perform cleanup before the node is destroyed.

C-rm3. `remove(node)` on the root node is an error.

C-rm4. `remove` triggers a tree notification (§8).

### 6.3 Middleware Interception

C21. Because `get`, `set`, `update`, `unset`, `append`, `remove`, and `sort` are
`createApi` operations, they can be intercepted by middleware installed in
ancestor scopes.

C22. A parent component MAY install middleware on `freedom:node` to validate,
transform, log, or reject property changes in its subtree.

C23. Middleware on `set` receives the `[key, value]` tuple and a `next`
function. It MAY modify the key or value before calling `next`, or it MAY skip
`next` to reject the mutation.

---

## 7. Event Dispatch

### 7.1 The Dispatch API

Freedom provides a dispatch API with event dispatch and node lookup:

```
createApi("freedom:dispatch", {
  *dispatch(event: unknown): Operation<Result<true>> {
    return { ok: false };
  },
  *getNodeById(id: string): Operation<Node | undefined>,
})
```

E1. The `dispatch` operation accepts a single argument of type `unknown`.
Freedom does not constrain, inspect, or interpret the event in any way.

E2. The default handler (at the bottom of the middleware chain) returns
`{ ok: false }`, indicating the event was unhandled.

E3. Middleware that handles an event MUST return `{ ok: true, value: true }`.

E4. If middleware throws an exception, the result MUST capture it as
`{ ok: false, error }`. The dispatch loop MUST NOT crash. The tree MUST remain
alive.

E4a. `getNodeById(id)` returns the node with the given `id`, or `undefined` if
no such node exists. This allows dispatch middleware to resolve event targets by
id and use `node.eval()` to dispatch application-level APIs in the target node's
scope.

### 7.2 The Synchronous Bridge

E5. `tree.dispatch(event)` is synchronous. It pushes the event into an Effection
`Signal`.

E6. Internally, an event loop reads from the Signal and dispatches each event
through the root node's scope:
`yield* root.eval(() => dispatch.operations.dispatch(event))`. The event loop
itself MAY run anywhere — it enters the root node's scope via `eval`, so
dispatch middleware installed by the root component is always in the chain.

E7. Events are processed sequentially — one at a time, in the order they were
dispatched. A new event is not processed until the previous event's entire
middleware chain has completed.

### 7.3 Demuxing

E8. Freedom does NOT provide built-in demuxing. It does not define event types,
event shapes, or event routing.

E9. Demuxing is the root component's responsibility. The root component installs
middleware on `freedom:dispatch` that routes events to application-specific
APIs.

E10. The root component is the first component to run, so its middleware is the
outermost layer — it sees every event before any child middleware.

E10a. Dispatch middleware uses `getNodeById()` and `node.eval()` to route events
to specific nodes. When an event targets a particular node, the middleware
resolves the node by id, then uses `eval` to invoke an application-level API in
that node's scope. The target node's middleware on that application API
participates because `eval` runs in the node's scope.

    ```ts
    // Example demux middleware (application-level, NOT Freedom)
    yield* DispatchApi.around({
      *dispatch([event], next) {
        if (isKeydown(event)) {
          let node = yield* DispatchApi.operations.getNodeById(event.targetId);
          if (node) {
            yield* node.eval(() => KeyboardApi.operations.keydown(event));
          }
          return { ok: true, value: true };
        }
        return yield* next(event);
      },
    });
    ```

E11. Applications define their own event APIs using `createApi`. These are NOT
part of Freedom.

E12. Multiple demux layers MAY compose. A root breaks raw events into
`keyboard`/`mouse` APIs. A child further breaks `keyboard` into `shortcut` based
on key bindings. Each layer is middleware on an API.

### 7.4 Event Helpers

E13. Per-event-type helper functions are an application-level pattern, NOT part
of Freedom. They are the sanctioned way for applications and framework layers to
build ergonomic event APIs on top of Freedom's generic `dispatch` + `around()`.

A helper wraps the raw `around()` API to hide the tuple destructuring and
provide TypeScript type narrowing:

```ts
// Definition (in the app's event layer, NOT in Freedom)
function onkeydown(
  handler: (
    event: KeydownEvent,
    next: (event: KeydownEvent) => Operation<void>,
  ) => Operation<void>,
): Operation<void> {
  return keyboard.around({
    *keydown([event], next) {
      return yield* handler(event, (e) => next(e));
    },
  });
}

// Usage in a component
function* searchBox(): Operation<void> {
  yield* set("query", "");

  yield* onkeydown(function* (event, next) {
    if (event.key === "Enter") {
      yield* update("query", () => event.text);
    } else {
      yield* next(event);
    }
  });
}
```

The helper is better than raw middleware because:

- The consumer sees `(event, next)` instead of `([event], next)`.
- TypeScript narrows `event` to `KeydownEvent` automatically.
- The `keyboard` API reference is encapsulated — the consumer does not need to
  know which API object to call `around()` on.

---

## 8. Tree and Notification

### 8.1 Tree Interface

```
interface Tree extends Stream<void, never> {
  dispatch(event: unknown): void;
  root: Node;
}
```

T1. The tree is an Effection resource. Creating it starts a root Effection scope
that owns all nodes and the event loop.

T2. `tree.root` is the root node. It is created when the tree is created and
exists for the tree's lifetime.

T3. `tree.dispatch(event)` is the synchronous event entry point (§7.2).

T4. The tree is a `Stream<void, never>`. Subscribing to the stream yields
notifications when the tree changes.

### 8.2 Creation

T5. `createTree(root: Component): Operation<Tree>` creates a tree. It: 1.
Creates the root Effection scope. 2. Creates the event Signal. 3. Creates the
root node. 4. Runs the root component within the root node's scope. 5. Spawns
the event loop, which dispatches events through the root node via `root.eval()`.
6. Returns the Tree.

T6. `createTree` returns once the root node's eval loop is ready to accept
operations. The root component runs concurrently within the root node's scope —
it MAY still be executing when `createTree` returns. The tree is usable as soon
as `eval` is operational.

### 8.3 Notification

T7. The tree emits a `void` notification on its output stream after each
dispatch cycle — that is, after one event has been fully processed through the
middleware chain and all resulting property mutations and structural changes
have settled.

T8. A dispatch cycle that produces no property changes, structural changes, or
sort function changes MUST NOT emit a notification.

T9. Multiple property mutations within a single dispatch cycle MUST coalesce
into a single notification. The renderer sees the final state, never
intermediate states.

T10. Structural changes (append, remove) and sort changes within a dispatch
cycle also coalesce with property changes into a single notification.

T11. Property mutations or structural changes that occur outside of a dispatch
cycle (e.g., during component initialization) MUST also emit notifications.

T12. The notification is `void`. It carries no information about what changed.
The renderer MUST walk the tree and read properties to determine the current
state.

### 8.4 Lifecycle

T13. Destroying the tree (exiting its Effection scope) destroys all nodes, stops
the event loop, and closes the output stream.

T14. Events dispatched after the tree is destroyed are silently dropped. This is
a natural consequence of structured concurrency — the event Signal is inert once
the tree's scope exits. Implementations do NOT need an explicit alive check.

---

## 9. Component

### 9.1 Signature

```
type Component = () => Operation<void>;
```

P1. A component is a generator function that takes no arguments and returns
`Operation<void>`.

P2. A component runs within a node's Effection scope. It accesses node
operations and event middleware through the ambient scope via `createApi`
operations.

P3. A component's lifetime is the node's lifetime. When the node is removed, the
component's operation is cancelled per Effection's structured concurrency.

### 9.2 Execution Model

P4. The node's scope outlives the component generator. When the generator
returns, the node remains alive — the eval loop (§5.3) keeps the scope active,
properties persist, and middleware remains active.

P5. A component takes one of two forms:

    **Initialization-only:** The component sets properties,
    installs middleware, appends children, and returns. The
    node lives on via its eval loop.

    ```ts
    function* header(): Operation<void> {
      yield* set("clay", { type: "element", bg: 0xFF0000 });
      yield* set("label", "Hello");
      yield* append("subtitle", subtitle);
    }
    ```

    **Reactive:** The component spawns a long-lived task
    that reacts to changes over time, then returns.

    ```ts
    function* clock(): Operation<void> {
      yield* spawn(function* () {
        let i = 0;
        while (true) {
          yield* set("tick", i++);
          yield* sleep(1000);
        }
      });
    }
    ```

    A component MAY also run an infinite loop inline,
    but this blocks the component body from returning.
    The eval loop and the component run concurrently
    regardless.

P6. Steps within a component (setting properties, installing middleware,
appending children) complete in order. This means middleware and children are
established before the component enters a reactive loop or returns.

---

## 10. Invariants

I1. **Scope-tree correspondence.** The node tree and the Effection scope tree
are isomorphic. Each node's scope is a child of its parent node's scope.

I2. **Structured teardown.** Removing a node destroys all its descendants in
reverse creation order. No orphaned nodes can exist.

I3. **Middleware scope binding.** Middleware installed in a node's scope is
active only while that node exists. When the node is removed, its middleware is
automatically removed.

I4. **Sequential dispatch.** Events are processed one at a time. No two events
are in-flight simultaneously.

I5. **Consistent notification.** The tree state visible to a renderer after a
notification is complete and consistent — all mutations from the triggering
dispatch cycle have been applied.

I6. **Property validity.** Every value in every node's property bag is a valid
JsonValue at all times.

I7. **Ordering consistency.** `node.children` always reflects the current
ordering — either insertion order or the sort function applied at read time
against current property values.

I8. **Node read-only plus methods.** The Node object's data fields (`id`,
`name`, `props`, `children`, `parent`) are read-only. All property reads and
mutations go through the `freedom:node` context API (`get`, `set`, `update`,
`unset`, `append`, `remove`, `sort`). `eval()` provides scoped operation
execution. `remove()` is both a convenience method and a context API operation —
the method delegates to the operation.

---

## 11. Deferred Extensions

The following are explicitly out of scope for this version.

### 11.1 Rich Change Records

The output stream emits `void`. A future version MAY emit structured change
records (`PropertyChange`, `StructuralChange`) with per-node, per-property
granularity. The JsonValue constraint and property bag structure are designed to
support this without API changes.

### 11.2 JSX Transform

A JSX transform that provides declarative sugar for `append()` calls is a
natural extension. Display properties would be set separately by each component
via the context API. JSX is a consumer of Freedom's imperative API, not a core
feature.

### 11.3 Reconciliation

Key-based reconciliation (matching old nodes to new declarations during
declarative re-rendering) is not supported. Nodes are managed imperatively via
`append` and `remove`. A reconciliation layer could be built on top of Freedom.

### 11.4 Computed Properties

Derived properties that update automatically when their dependencies change are
not supported. Components can implement this pattern manually by installing
middleware on `set`.

### 11.5 Node Queries

Querying the tree by property values, name patterns, or other criteria is not
provided. `getNodeById()` is provided as part of the dispatch API (§7.1) for
event targeting. For other queries, consumers walk the tree via `root` and
`children`.

### 11.6 Event Bubbling / Capturing

Freedom does not define event propagation phases. Middleware composition through
the scope tree provides a similar capability, but the traversal order is
determined by middleware installation order, not by a DOM-style capture/bubble
model.

### 11.7 Explicit Index Ordering

A built-in ordering mode based on an `index` property is not provided. If an
application wants index-based ordering, it sets an `index` property on child
nodes and provides a sort function that reads it.

---

## 12. Implementation Files

**`lib/types.ts`** — `JsonValue`, `Component`, `Node` interface, `Tree`
interface.

**`lib/tree.ts`** — `createTree(root: Component)`. Root scope, event Signal,
output stream, event loop, notification coalescing.

**`lib/node.ts`** — Node resource. Child scope, property bag, children list with
read-time sort.

**`lib/dispatch.ts`** — `createApi("freedom:dispatch", ...)`.
`dispatch(event: unknown) → Result<true>` and
`getNodeById(id: string) → Node | undefined`. Sync→operational bridge via
Signal.

**`lib/freedom.ts`** — `createApi("freedom:node", ...)`. `useNode`, `get`,
`set`, `update`, `unset`, `append`, `remove`, `sort` operations.

**`lib/mod.ts`** — Re-exports.

---

## 13. Dependencies

Freedom depends on Effection 4.1-alpha for:

- `createApi` — context-scoped API with middleware
- `createContext` — scoped state
- `Signal` — synchronous write, operational read
- `Stream` — async iteration protocol
- `resource` — long-lived scoped values
- `spawn` — concurrent child tasks
- `Result` — success/failure envelope
- `Operation` — the base computation type
