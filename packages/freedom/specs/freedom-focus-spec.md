# Freedom Focus Specification

**Version:** 0.1 — Draft\
**Status:** Normative draft\
**Depends on:** Freedom Specification 0.1, Effection 4.1-alpha

---

## 1. Purpose

Focus tracks which node in the tree is currently receiving input. At any point
in time at most one node is focused; while at least one focusable node exists,
exactly one is. The focus system provides structured,
linear navigation through focusable nodes and exposes focus state as an
observable node property.

Focus is an extension to Freedom, not a core primitive. It is installed by the
root component and built entirely on Freedom's context APIs — property
operations, middleware interception, and scoped evaluation.

---

## 2. Design Philosophy

### 2.1 Minimal and linear

This specification covers linear focus navigation only: forward, backward, and
explicit. Directional navigation (up/down/left/right), focus groups, focus
trapping, and focus restoration are deferred to future extensions.

### 2.2 Opt-in focusability

Nodes are not focusable by default. A node becomes focusable by calling
`yield* focusable()` in its component body. This sets the `focused` property to
`false`, adding the node to the focus chain without granting it focus.

### 2.3 Observable via properties

Focus state is a regular node property: `node.props.focused`. Renderers observe
focus the same way they observe any other property — by reading props after a
notification. No special subscription mechanism is needed.

### 2.4 Built on Freedom APIs

Focus operations are **synchronous functions** that take a node and use the
node's synchronous methods. Focus movement calls `node.set("focused", …)`
directly. Focus cleanup installs a synchronous interceptor on `remove` via
`node.scope.around(NodeApi, …)`. No internal state is accessed directly.

---

## 3. Terminology

**Focusable node.** A node whose property bag contains the key `"focused"`. The
value is `true` (this node has focus) or `false` (this node can receive focus
but does not currently have it). A node without a `"focused"` property is not
focusable.

**Focused node.** The unique node whose `focused` property is `true`. When the
focus system is installed and the container has at least one focusable
descendant, exactly one node is focused. With no focusable descendants, no node
is focused and `current()` falls back to the container (§4.2 F17).

**Focus chain.** The ordered sequence of all focusable nodes in the tree,
computed by depth-first traversal. The focus chain determines the order in which
`advance` and `retreat` move focus. The chain is computed on demand — it is not
stored.

---

## 4. Focus API

### 4.1 API Definition

Focus is a set of **synchronous functions** that take a `Node` (used to locate
the tree root), plus `useFocus` to install it:

```
focusable(node: Node): void
advance(node: Node): void
retreat(node: Node): void
focus(target: Node): void
current(node: Node): Node
useFocus(node: Node): void
focusPush(node: Node, callback?: (value: unknown) => void): PopFocus
```

where `PopFocus = (value?: unknown) => void` is the bound pop function returned
by `focusPush` (§12).

These are plain functions (not `createApi` operations) and are not
middleware-interceptable in this version; focus trapping and the like remain
deferred (§9). Focus movement is performed with `node.set("focused", …)`.

### 4.2 Operations

**focusable**

F1. `focusable()` makes the current node focusable by setting its `focused`
property to `false` via `yield* set("focused", false)`.

F2. If the current node is already focusable (the `focused` property already
exists), `focusable()` is a no-op.

F3. `focusable()` is a `createApi` operation and can be intercepted by
middleware. A parent MAY install middleware on `focusable` to prevent a child
from becoming focusable.

**advance**

F4. `advance()` moves focus to the next focusable node in the focus chain (§5).

F5. If the currently focused node is the last in the focus chain, `advance()`
wraps to the first focusable node.

F6. Focus movement sets the old node's `focused` property to `false` and the new
node's `focused` property to `true`, using `node.eval()` to run property
operations in each node's scope (§6.2).

F7. If the focus chain contains only one focusable node (including root),
`advance()` is a no-op.

**retreat**

F8. `retreat()` moves focus to the previous focusable node in the focus chain
(§5).

F9. If the currently focused node is the first in the focus chain, `retreat()`
wraps to the last focusable node.

F10. Focus movement follows the same mechanism as `advance` (F6).

F11. If the focus chain contains only one focusable node, `retreat()` is a
no-op.

**focus**

F12. `focus(node)` sets focus to the given node explicitly.

F13. The target node MUST be a member of the active focus chain (§12.3): it MUST
be focusable (its `focused` property MUST exist) **and** a descendant of the
active focus root. `focus` MUST raise an error for a target that is not
focusable, or that is focusable but lies outside the active focus root (§12.6,
FS12).

F14. Focus movement follows the same mechanism as `advance` (F6).

F15. If the target node is already focused, `focus()` is a no-op.

**current**

F16. `current()` returns the currently focused node — the node whose `focused`
property is `true`.

F17. `current()` always returns a `Node`. It never returns `undefined`: it
returns the focused node, or — when no node is focused — falls back to the
active focus root (§12.3, which is the tree root when the focus stack is empty).
Never-null is guaranteed by the fallback, not by making the container a member
of the focus chain.

F18. `current()` is a `createApi` operation and can be intercepted by
middleware. This enables future extensions (e.g., focus scoping) to override
which node is considered "current" within a subtree.

### 4.3 Middleware Interception

F19. Because `focusable`, `advance`, `retreat`, `focus`, and `current` are
`createApi` operations, they can be intercepted by middleware installed in
ancestor scopes.

F20. A parent component MAY install middleware on `freedom:focus` to redirect
focus, prevent focus changes, or add side effects (e.g., scroll-into-view).

---

## 5. Focus Chain

### 5.1 Computation

FC1. The focus chain is the ordered sequence of all focusable nodes in the
subtree of the **active focus root** (§12.3), determined by a depth-first
traversal starting from that root. When the focus stack is empty the active
focus root is the tree root, so the chain spans the whole tree; when a node has
been pushed (§12.4) the chain is confined to that node's subtree.

FC2. A node is included in the focus chain if and only if its property bag
contains the key `"focused"` (with value `true` or `false`).

FC3. The traversal visits children in their iteration order (`node.children`),
which respects any active sort function (§5.6 of the Freedom spec). This means a
parent's sort function affects focus order.

FC4. The focus chain is computed on demand — when `advance`, `retreat`, or
`current` needs it. It is not stored or cached. This ensures the chain is always
consistent with the current tree state.

### 5.2 Dynamic behavior

FC5. The focus chain changes dynamically as nodes become focusable
(`focusable()`), are removed (`remove`), or are reordered (sort function
changes).

FC6. Adding a new focusable node does not move focus. The new node joins the
chain at its tree-order position with `focused: false`.

FC7. Changing a parent's sort function may reorder the focus chain. Focus does
not move — the focused node retains `focused: true` regardless of its new
position in the chain.

---

## 6. Focus Lifecycle

### 6.1 Installation

FL1. Focus is installed by calling `useFocus(root.node)`:

    ```ts
    const root = createRoot();
    useFocus(root.node);
    ```

FL2. `useFocus(node)` performs two actions: 1. Seeds initial focus on the first
focusable descendant in chain order (§5), if any. The container node itself is
not focused and is not added to the focus chain. If there are no focusable
descendants, nothing is focused and `current()` falls back to the container. 2.
Installs a synchronous `remove` interceptor on the node's scope
(`node.scope.around(NodeApi, …)`) to handle focused-node removal (§6.3). Because
it is installed on the node's scope, the interceptor applies to all descendants.

FL3. Seeding is one-shot: it happens only at the `useFocus` call. A focusable
descendant added later does not become focused automatically. Maintaining "one
focused descendant whenever any focusable descendant exists" is deferred to the
focus-container extension (§9).

### 6.2 Focus movement

FL4. When focus moves from node A to node B, the focus system calls
`A.set("focused", false)` and `B.set("focused", true)` — synchronous mutations.

FL5. Both changes go through `NodeApi`. Interceptors on `set` see focus changes
and may react to or redirect them.

FL6. Both changes mark the tree dirty; they coalesce into a single notification
if they occur within the same dispatch cycle.

### 6.3 Focused node removal

FL7. `useFocus` installs a synchronous `remove` interceptor that, when the node
being removed is focused, moves focus to its successor before teardown:

    ```ts
    node.scope.around(NodeApi, {
      remove([target], next) {
        if (target.props.focused === true) {
          const successor = successorOf(target);
          if (successor && successor !== target) focus(successor);
        }
        return next(target);
      },
    });
    ```

FL8. If the removed node is the only focusable node, there is no successor; after
removal nothing is focused and `current()` falls back to the container.
(Removing root is an error, C-rm3.)

FL9. The successor is focused before `next(target)` tears the node down, so focus
never lands on a destroyed node.

---

## 7. Interaction with Notification

FN1. Focus changes are property changes. They flow through Freedom's existing
notification system — no special notification mechanism is needed.

FN2. When focus moves during a dispatch cycle (e.g., in response to a keypress),
the focus property changes coalesce with other property changes into a single
notification.

FN3. When focus moves outside a dispatch cycle (e.g., during component
initialization via `useFocus()`), the property change emits its own notification
per Freedom's existing rules (T11).

FN4. Renderers observe focus by reading `node.props.focused` after a
notification, the same way they read any other property.

---

## 8. Invariants

FI1. **Singleton focus.** At most one node in the tree has `focused: true` at
any time. When the focus system is installed and at least one focusable
descendant exists, exactly one node has `focused: true`; with no focusable
descendants, none does.

FI2. **Focus chain consistency.** The focus chain is always derivable from the
current tree state by depth-first traversal. No external data structure is
needed.

FI3. **The active focus root is a non-participating container.** By default the
root node is not enrolled in the focus chain (it has no `focused` property), so
`advance`/`retreat` ring only over its focusable descendants — root is never a
focus stop. Root serves as the last-resort focus target through `current()`'s
fallback, not through chain membership. Escape hatch: explicitly calling
`focusable(root)` enrolls root into the ring like any other node. The focus
stack (§12) generalizes this: at any time the active focus root — the top of the
stack, or the tree root when the stack is empty — is the non-participating
container the ring is confined to.

FI4. **Cleanup on removal.** When a focused node is removed, focus advances to
the next node in the chain before the node is destroyed. This is guaranteed by
middleware on `remove`.

FI5. **API consistency.** All focus operations go through `createApi` and are
middleware-interceptable. Focus movement uses `node.eval()` and the
`freedom:node` context API for property changes.

---

## 9. Deferred Extensions

The following are explicitly out of scope for this version.

### 9.1 Focus Trapping and Locking

**Status: trapping is now provided by the focus stack (§12).** A focus trap
prevents focus from leaving a subtree (e.g., a modal dialog); `focusPush`
establishes exactly such a trap by confining the focus chain to the pushed
node's subtree. A focus **lock** (preventing focus from changing at all) remains
deferred.

### 9.2 Focus Groups

Focus groups partition the focus chain into segments navigated independently —
arrow keys move within a group, Tab moves between groups. This requires a second
level of navigation beyond the linear `advance`/`retreat` model.

### 9.3 Focus Restoration

**Status: now provided by the focus stack (§12).** `focusPush` records the node
focused at push time; the `PopFocus` it returns restores that node. Restoration
is stack-based rather than tied to the component lifecycle.

### 9.4 Directional Navigation

Spatial or directional navigation (up/down/left/right) requires a layout-aware
focus algorithm that scores candidate nodes by position and direction. This is
independent of linear navigation and may require renderer-specific information
(e.g., bounding rectangles).

---

## 10. Implementation Files

**`lib/focus.ts`** — `createApi("freedom:focus", ...)`. `focusable`, `advance`,
`retreat`, `focus`, `current` operations. `useFocus()` installation resource.
`focusPush` (returning `PopFocus`) stack operation and the active-focus-root
resolution (§12).

**`lib/mod.ts`** — Re-exports focus API and operations.

---

## 11. Dependencies

Freedom Focus depends on:

- Freedom Specification 0.1 — `freedom:node` context API (`get`, `set`,
  `remove`), `Node`, `Tree`, `node.eval()`
- Effection 4.1-alpha — `createApi`, `Operation`, `resource`

---

## 12. Focus Stack (Trapping and Restoration)

### 12.1 Purpose

Focus trapping (§9.1) and focus restoration (§9.3) are provided by the **focus
stack**. The stack generalizes the single non-participating container of FI3
(the tree root) into a LIFO stack of **focus roots**. Pushing a node makes it
the active focus root: forward and backward cycling are confined to its
focusable descendants, to the exclusion of every other node in the tree. Popping
restores focus to where it was before the push and delivers a result value to
the pusher.

### 12.2 API

One plain function, consistent with §4.1 (not a `createApi` operation in this
version). It returns the **bound pop function** for the push:

```
type PopFocus = (value?: unknown) => void

focusPush(node: Node, callback?: (value: unknown) => void): PopFocus
```

There is no standalone `focusPop`: popping is done by calling the `PopFocus`
returned by the matching `focusPush`. The returned function closes over the
tree, so no node or ambient pointer is needed to pop (this is why `focusPush`
returns it rather than exposing a free `focusPop(value)`).

### 12.3 The stack and the active focus root

FS1. The focus stack is an ordered (LIFO) list of **entries**. Each entry is
`{ node, restore, callback }`: `node` is the pushed focus root, `restore` is the
node that was focused at the moment of the push (or `undefined` if none), and
`callback` is the optional function passed to `focusPush`.

FS2. The stack is scoped to the tree, not module-global (AGENTS "State"). It
lives in the tree's `TreeState`, which is held on the root node's scope context
(`root.scope.set(TreeContext, …)`); `focusPush` reaches it from its `node`
argument via `node.scope.expect(TreeContext)`. The returned `PopFocus` closes
over that same `TreeState`, so popping needs no node or ambient pointer. The
stack is empty by default.

FS3. The **active focus root** is the `node` of the top stack entry, or — when
the stack is empty — the tree root (the non-participating container of FI3).

FS4. The focus chain (§5) is computed from the active focus root, not the tree
root. `advance`, `retreat`, `current`, and successor-on-removal (§6.3) all
operate over this chain. Only focusable descendants of the active focus root
participate; every other node is excluded. Cycling is airtight (FS14).

### 12.4 focusPush

FS5. `focusPush(node, callback?)` pushes an entry `{ node, restore, callback }`,
where `restore` is the currently focused node (the member of the active focus
chain with `focused: true`), or `undefined` if none is focused. It returns a
`PopFocus` bound to this entry (FS9).

FS6. After pushing, focus moves to the first focusable descendant of `node` in
chain order (§5), via `focus()` (§4.2). If `node` has no focusable descendant,
nothing is focused and `current()` falls back to `node` (FS3, F17).

FS7. `node` is a non-participating container: it is not itself a focus stop
unless it was separately made focusable (FI3, generalized).

FS8. Nesting is allowed. `focusPush` MAY be called while the stack is non-empty;
the new entry becomes the active focus root. `node` need not be a descendant of
the previously active focus root — peer containers are permitted.

### 12.5 Popping (the returned `PopFocus`)

FS9. `focusPush` returns a `PopFocus` bound to the entry it pushed. Calling it,
`pop(value?)`, removes the top stack entry. The entry it removes MUST be the
entry this `pop` was bound to — i.e. push/pop are balanced (LIFO). Calling a
`pop` when its entry is not on top, or when the stack is empty, is a bug and
MUST raise an error. A `pop` is idempotent-safe only in that a second call (its
entry already gone) raises the same balance error.

FS10. After removing the entry, focus is restored: if the entry's `restore` node
still exists and is a member of the now-active focus chain, `focus(restore)` is
called; otherwise focus is seeded on the first focusable descendant of the
now-active focus root, and if there is none, nothing is focused.

FS11. The entry's `callback`, if present, is then invoked exactly once with
`value`. It is invoked **after** focus has been restored (FS10).

### 12.6 Interaction with explicit focus and removal

FS12. `focus(target)` is constrained by the active focus root: a valid target
MUST be a member of the active focus chain — focusable **and** a descendant of
the active focus root. `focus()` on a node that is not focusable, or that is
focusable but lies outside the active focus root, MUST raise an error (this
revises F13). Because `pop` removes the top entry *before* restoring focus
(FS10), the `restore` target is evaluated against the now-active root and is a
valid target.

FS13. Successor-on-removal (§6.3, FL7) computes the successor within the active
focus chain, so removing the focused node keeps focus inside the active focus
root.

### 12.7 Invariants

FS14. **Airtight cycling.** `advance` and `retreat` never move focus to a node
outside the active focus root.

FS15. **Balanced restoration.** Each `focusPush` is paired with a call to its
returned `PopFocus` that restores the pre-push focus (FS10) and invokes the
push's callback exactly once (FS11).
