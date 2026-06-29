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
```

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

F13. The target node MUST be focusable (its `focused` property MUST exist). If
the target is not focusable, `focus` MUST raise an error.

F14. Focus movement follows the same mechanism as `advance` (F6).

F15. If the target node is already focused, `focus()` is a no-op.

**current**

F16. `current()` returns the currently focused node — the node whose `focused`
property is `true`.

F17. `current()` always returns a `Node`. It never returns `undefined`: it
returns the focused node, or — when no node is focused — falls back to the
container (the focus root). Never-null is guaranteed by the fallback, not by
making the container a member of the focus chain.

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

FC1. The focus chain is the ordered sequence of all focusable nodes in the tree,
determined by a depth-first traversal of the tree starting from the root.

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

FI3. **Root is a non-participating container.** By default the root node is not
enrolled in the focus chain (it has no `focused` property), so `advance`/
`retreat` ring only over its focusable descendants — root is never a focus stop.
Root serves as the last-resort focus target through `current()`'s fallback, not
through chain membership. Escape hatch: explicitly calling `focusable(root)`
enrolls root into the ring like any other node.

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

A focus trap prevents focus from leaving a subtree (e.g., a modal dialog). A
focus lock prevents focus from changing at all. Both require middleware on
`advance`, `retreat`, and `focus` that constrains movement. The current API is
designed to support this via middleware without changes to the core focus
operations.

### 9.2 Focus Groups

Focus groups partition the focus chain into segments navigated independently —
arrow keys move within a group, Tab moves between groups. This requires a second
level of navigation beyond the linear `advance`/`retreat` model.

### 9.3 Focus Restoration

Focus restoration remembers the previously focused node when entering a focus
scope (e.g., opening a modal) and restores it when the scope exits. This
interacts with focus trapping and the component lifecycle.

### 9.4 Directional Navigation

Spatial or directional navigation (up/down/left/right) requires a layout-aware
focus algorithm that scores candidate nodes by position and direction. This is
independent of linear navigation and may require renderer-specific information
(e.g., bounding rectangles).

---

## 10. Implementation Files

**`lib/focus.ts`** — `createApi("freedom:focus", ...)`. `focusable`, `advance`,
`retreat`, `focus`, `current` operations. `useFocus()` installation resource.

**`lib/mod.ts`** — Re-exports focus API and operations.

---

## 11. Dependencies

Freedom Focus depends on:

- Freedom Specification 0.1 — `freedom:node` context API (`get`, `set`,
  `remove`), `Node`, `Tree`, `node.eval()`
- Effection 4.1-alpha — `createApi`, `Operation`, `resource`
