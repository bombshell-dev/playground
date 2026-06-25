# Freedom — Conformance Test Plan

**Tests:** Freedom Specification

---

## 1. Test Plan Scope

### 1.1 What This Plan Covers

This test plan defines conformance criteria for the Freedom component tree as
specified in the Freedom Specification. It covers:

- JsonValue validation at the `set`/`update` boundary (§4)
- Node lifecycle: creation via `append`, destruction via `remove`, structured
  teardown (§5.3)
- Node identity: unique `id` assignment (§5.2)
- Property bag: `set`, `update`, `unset` operations (§6.2)
- Property bag read-only enforcement (§5.4)
- Child ordering: insertion order, custom sort at read time (§5.5)
- Sort installation/removal notification (N19)
- Node context API middleware interception (§6.3)
- Event dispatch: single API, `Result<true>` signaling, error capture (§7.1)
- Synchronous bridge: Signal-based dispatch, sequential processing (§7.2)
- Tree creation and lifecycle (§8.2, §8.4)
- Notification coalescing, including no-change suppression (§8.3)
- Component execution model (§9)
- All invariants (§10)

### 1.2 What This Plan Does Not Cover

- JSX transforms (§11.2)
- Reconciliation (§11.3)
- Computed properties (§11.4)
- Node queries (§11.5)
- Event bubbling/capturing (§11.6)
- Explicit index ordering (§11.7)
- Rich change records (§11.1)
- Application-level demux patterns (§7.3) — these are tested in application test
  suites, not Freedom's
- Event helper functions (§7.4) — application-level pattern

### 1.3 Tiers

**Core:** Tests that every conforming implementation MUST pass. A Freedom
implementation is non-conforming if any Core test fails.

**Extended:** Tests for edge cases, boundary conditions, and robustness.
Recommended but not strictly required.

---

## 2. JsonValue Validation

### 2.1 Core: Valid Values

JV1. `set("k", "hello")` — string accepted. JV2. `set("k", 42)` — number
accepted. JV3. `set("k", 0)` — zero accepted. JV4. `set("k", -1.5)` — negative
float accepted. JV5. `set("k", true)` — boolean accepted. JV6. `set("k", false)`
— boolean false accepted. JV7. `set("k", null)` — null accepted. JV8.
`set("k", [1, "a", true, null])` — array accepted. JV9.
`set("k", { a: 1, b: "c" })` — object accepted. JV10.
`set("k", { nested: { deep: [1, 2] } })` — nested structures accepted. JV11.
`set("k", [])` — empty array accepted. JV12. `set("k", {})` — empty object
accepted.

### 2.2 Core: Invalid Values

JV13. `set("k", undefined)` — MUST raise error (J1). JV14. `set("k", NaN)` —
MUST raise error (J2). JV15. `set("k", Infinity)` — MUST raise error (J2). JV16.
`set("k", -Infinity)` — MUST raise error (J2). JV17. `set("k", () => {})` — MUST
raise error (J3). JV18. `set("k", Symbol())` — MUST raise error (J3). JV19.
`set("k", new Date())` — MUST raise error (J3). JV20. `set("k", new Map())` —
MUST raise error (J3).

### 2.3 Core: update() Validation

JV21. `update("k", () => undefined)` — MUST raise error. The return value of the
update function is validated. JV22. `update("k", () => NaN)` — MUST raise error.
JV23. `update("k", () => 42)` — accepted.

---

## 3. Node Lifecycle

### 3.1 Core: Creation

NL1. `append("child", component)` creates a child node. The returned node has
`name === "child"`. NL2. The child appears in `parent.children`. NL3. The
child's `parent` is the appending node. NL4. The child's `props` is initially
empty (`{}`). NL5. The child's component runs within the child's scope. NL6.
Multiple children can be appended to the same parent.

### 3.2 Core: Node ID

NL7. Each created node has a non-empty `id` string (N2). NL8. Two sibling nodes
have different `id` values (N2). NL9. A node's `id` does not change after
creation (N2). NL10. Nodes in different subtrees have different `id` values (N2
— unique across the tree). NL11. The root node has an `id`.

### 3.3 Core: Destruction

NL12. `remove()` destroys the node. The node no longer appears in its parent's
`children`. NL13. `remove()` on a node with children destroys all descendants.
NL14. Descendant destruction occurs in reverse creation order (LIFO). NL15.
After `remove()`, middleware installed by the node's component is no longer
active. NL16. `remove()` on the root node MUST raise an error (C18).

### 3.4 Extended: Edge Cases

NL17. Appending to a node that is being removed — behavior is
implementation-defined but MUST NOT corrupt the tree. NL18. A component that
returns immediately (no loop) — the node remains alive (P4).

---

## 4. Property Bag

### 4.1 Core: set

PB1. `set("a", 1)` — `node.props["a"]` is `1`. PB2. `set("a", 1)` then
`set("a", 2)` — `node.props["a"]` is `2`. PB3. `set("a", 1)` then `set("b", 2)`
— both keys present. PB4. `set("ns", { x: 1, y: 2 })` — namespaced object
stored. PB5. `node.props` reflects the update immediately after `set` completes
(N13).

### 4.2 Core: update

PB6. `set("n", 1)` then `update("n", (v) => v + 1)` — `node.props["n"]` is `2`.
PB7. `update("missing", (v) => v ?? 0)` — `fn` receives `undefined`, stores `0`.
PB8. `update` is atomic: `node.props` reflects the new value after `update`
completes.

### 4.3 Core: unset

PB9. `set("a", 1)` then `unset("a")` — `"a"` is no longer in `node.props`. PB10.
`unset("nonexistent")` — no error, no notification (C9, C10).

### 4.4 Core: Read-Only Enforcement

PB11. Direct assignment to `node.props["x"] = 1` MUST NOT modify the property
bag OR MUST throw (N12). Implementations SHOULD freeze or proxy `props`.

---

## 5. Child Ordering

### 5.1 Core: Insertion Order

CO1. Append A, B, C. `children` yields A, B, C. CO2. Append A, B, C. Remove B.
`children` yields A, C. CO3. Append A, B. Remove A. `children` yields B.

### 5.2 Core: Custom Sort

CO4. Set sort function `(a, b) => cmp(a.props.priority, b.props.priority)`.
Append A (priority=3), B (priority=1), C (priority=2). `children` yields B, C,
A. CO5. With active sort, change B's priority from 1 to 10. Next iteration of
`children` yields C, A, B (sort applied at read time, N18). CO6. Clear sort
function via `sort(undefined)`. `children` reverts to insertion order: A, B, C.

### 5.3 Core: Sort Notification

CO7. Install a sort function. Stream emits notification (N19, C20). CO8. Clear a
sort function. Stream emits notification (N19, C20).

### 5.4 Extended: Sort Edge Cases

CO9. Sort function that throws — behavior is implementation-defined but MUST NOT
corrupt the children list. CO10. Sort with equal comparisons — insertion order
is the tiebreaker (N16).

---

## 5b. useNode Operation

### 5b.1 Core: Node Resolution

UN1. `useNode()` in the root component returns the root node.
`node === tree.root`.

UN2. `useNode()` inside a child component returns the child node. `node.name`
matches the child's name and `node !== tree.root`.

UN3. `useNode()` via `node.eval()` returns the eval target node.

### 5b.2 Core: Middleware Interception

UN4. Parent installs middleware on `useNode`. Child calls `useNode()`. Parent
middleware intercepts and may substitute a different node reference.

---

## 6. Node Context API Middleware

### 6.1 Core: Interception

MW1. Parent installs middleware on `set`. Child calls `set("x", 1)`. Parent
middleware receives `["x", 1]` and `next`. Parent calls `next("x", 1)`.
`child.props["x"]` is `1`.

MW2. Parent middleware transforms: receives `["x", 1]`, calls `next("x", 2)`.
`child.props["x"]` is `2`.

MW3. Parent middleware rejects: receives `["x", 1]`, does NOT call `next`.
`child.props["x"]` is unchanged.

MW4. Middleware on `update` receives the `[key, fn]` tuple.

MW5. Middleware on `append` can intercept child creation.

MW6. Middleware on `sort` can intercept sort installation.

### 6.2 Core: Scope Isolation

MW7. Middleware installed in node A's scope does NOT intercept operations in
node A's sibling B.

MW8. Middleware installed in a parent's scope intercepts operations in all
descendants (scope inheritance).

MW9. After `remove()` on a node, its middleware is inactive. Subsequent
operations in sibling nodes are not affected.

---

## 7. Event Dispatch

### 7.1 Core: Basic Dispatch

ED1. Dispatch an event. Root middleware receives it. Returns
`{ ok: true, value: true }`. Result indicates handled.

ED2. Dispatch an event with no middleware installed beyond the default handler.
Result is `{ ok: false }` — unhandled.

ED3. Dispatch two events sequentially. Each is processed in order. The second
event's middleware sees state changes from the first.

### 7.2 Core: Error Capture

ED4. Middleware throws an exception. Result is `{ ok: false, error }`. The tree
is still alive. Subsequent dispatches work normally.

ED5. Middleware throws in a child scope. The error is captured. The child node
is NOT destroyed (the dispatch loop catches the error, the scope survives).

### 7.3 Core: Middleware Composition

ED6. Root installs dispatch middleware. Child installs dispatch middleware.
Event flows through root middleware first (outermost), then child middleware.

ED7. Root middleware can short-circuit by not calling `next`. Child middleware
never sees the event.

ED8. Child middleware handles an event (returns handled result). Root
middleware's `next` receives the child's result.

### 7.4 Core: Sequential Processing

ED9. Dispatch event A, then event B while A is still processing. B is queued. B
is processed after A completes.

ED10. Within one dispatch cycle, all property mutations are visible to
subsequent middleware in the same chain.

---

## 8. Tree and Notification

### 8.1 Core: Creation

TN1. `createTree(root)` returns a Tree. `tree.root` is a Node.
`tree.root.parent` is `undefined`.

TN2. The root component runs before `createTree` returns (T6). Properties set
during initialization are visible on `tree.root.props`.

TN3. Middleware installed by the root component during initialization is active
for the first dispatched event.

### 8.2 Core: Notification Stream

TN4. Subscribe to tree stream. Call `set` on any node. Stream emits `void`.

TN5. Subscribe to tree stream. Call `append`. Stream emits `void`.

TN6. Subscribe to tree stream. Call `remove`. Stream emits `void`.

TN7. Within one dispatch cycle, call `set` three times on different nodes.
Stream emits exactly ONE `void` (coalescing, T9).

TN8. Within one dispatch cycle, call `set` and `append`. Stream emits exactly
ONE `void` (T10).

TN9. Dispatch an event whose middleware makes no property or structural changes.
Stream MUST NOT emit (T8).

### 8.3 Core: Initialization Notification

TN10. Root component calls `set` during initialization (before any dispatch).
Stream emits a notification (T11).

### 8.4 Core: Lifecycle

TN11. Destroy the tree (exit its Effection scope). The output stream closes.

TN12. Dispatch an event after the tree is destroyed. No error, no effect (T14).

---

## 9. Component

### 9.1 Core: Execution

CP1. A component's generator runs when the node is created.

CP2. A component that returns without looping — the node remains alive (P4).
Properties set during execution persist. Middleware installed during execution
remains active.

CP3. A component in an infinite loop continues reacting until the node is
removed.

CP4. A component can set properties, install middleware, and append children
before returning or entering a loop (P6).

### 9.2 Core: Cancellation

CP5. When a node is removed, the component's operation is cancelled. `finally`
blocks in the component run (Effection structured concurrency).

---

## 10. Invariant Verification

### 10.1 Core

IV1. After any sequence of operations, the node tree and scope tree are
isomorphic (I1). Verify by walking both trees and comparing structure.

IV2. After removing a subtree, no orphaned nodes exist (I2). Verify that removed
nodes do not appear in any `children` iteration.

IV3. After removing a node, its middleware is inactive (I3). Verify by
dispatching an event and confirming the removed node's middleware is not called.

IV4. Two concurrent dispatches do not interleave (I4). Verify by dispatching two
events that each set a property, and confirming the final state reflects
sequential execution.

IV5. After a notification, `node.props` and `node.children` reflect the final
state of all mutations from the triggering cycle (I5).

IV6. No invalid JsonValue can exist in any node's property bag at any time (I6).

IV7. Node fields are read-only (I8). Direct mutation of `id`, `name`, `props`,
`children`, or `parent` is rejected or has no effect.

---

## 11. Explicit Non-Tests

The following scenarios are explicitly NOT tested because they correspond to
deferred extensions (§11 of the spec):

NT1. JSX transform producing `append` calls. NT2. Key-based reconciliation of
children. NT3. Computed/derived properties. NT4. Tree query operations. NT5.
DOM-style event bubbling or capturing phases. NT6. Structured change records on
the output stream. NT7. Application-level demux middleware (tested by apps).
NT8. Event helper functions like `onkeydown` (app-level). NT9. Explicit index
ordering mode.
