# Freedom Focus — Conformance Test Plan

**Tests:** Freedom Focus Specification

---

## 1. Test Plan Scope

### 1.1 What This Plan Covers

This test plan defines conformance criteria for the Freedom Focus extension as
specified in the Freedom Focus Specification. It covers:

- Installation via `useFocus()` (§6.1)
- `focusable()` operation (§4.2)
- Focus chain computation via depth-first traversal (§5)
- `advance()` and `retreat()` with wrapping (§4.2)
- `focus(node)` explicit focus (§4.2)
- `current()` query (§4.2)
- Focused node removal (§6.3)
- Notification interaction (§7)
- All invariants (§8)

It also covers the core spec additions required by focus:

- `get(key)` operation (Freedom Spec §6.2)
- `remove(node)` operation (Freedom Spec §6.2)

### 1.2 What This Plan Does Not Cover

- Focus trapping and locking (§9.1)
- Focus groups (§9.2)
- Focus restoration (§9.3)
- Directional navigation (§9.4)
- Focus middleware interception (tested by applications)

### 1.3 Tiers

**Core:** Tests that every conforming implementation MUST pass.

**Extended:** Tests for edge cases and robustness.

---

## 2. Core Spec Additions

### 2.1 Core: get operation

GA1. `set("k", 42)` then `get("k")` — returns `42`. GA2. `get("missing")` —
returns `undefined`. GA3. `get` middleware can intercept reads.

### 2.2 Core: remove operation

RA1. `remove(child)` destroys the child node. The child no longer appears in
parent's `children`. RA2. `remove(root)` raises an error. RA3. `remove`
middleware can intercept removal. RA4. `remove` middleware runs before teardown
— the node is still in the tree when middleware executes.

---

## 3. Installation

### 3.1 Core: useFocus

FI1. After `useFocus()`, root has `focused: true`. FI2. After `useFocus()`, root
is in the focus chain. FI3. `current()` returns root after installation.

---

## 4. focusable()

### 4.1 Core: Opt-in

FF1. `focusable()` sets `focused: false` on the current node. FF2. After
`focusable()`, the node appears in the focus chain. FF3. `focusable()` on an
already-focusable node is a no-op. FF4. A node that never calls `focusable()` is
not in the focus chain.

---

## 5. Focus Chain

### 5.1 Core: Depth-First Order

FC1. Root with children A, B, C — all focusable. Chain order is root, A, B, C.
FC2. Root with child A (focusable), A has child A1 (focusable), root has child B
(focusable). Chain order is root, A, A1, B. FC3. Non-focusable nodes are
skipped. Root (focusable), A (not focusable), B (focusable). Chain is root, B.

### 5.2 Core: Sort Function Interaction

FC4. Parent has sort function reversing children. Children A, B, C appended in
order but sorted as C, B, A. Focus chain reflects sorted order.

---

## 6. advance()

### 6.1 Core: Forward Navigation

FA1. Focus on root, advance → focus moves to first focusable child. FA2. Focus
on child A, advance → focus moves to child B. FA3. Old node gets
`focused: false`, new node gets `focused: true`.

### 6.2 Core: Wrapping

FA4. Focus on last focusable node, advance → wraps to first focusable node
(root).

### 6.3 Core: Single Node

FA5. Only one focusable node (root). `advance()` is a no-op. Root stays focused.

---

## 7. retreat()

### 7.1 Core: Backward Navigation

FR1. Focus on child B, retreat → focus moves to child A. FR2. Focus on first
focusable child, retreat → wraps to last focusable node.

### 7.2 Core: Single Node

FR3. Only one focusable node. `retreat()` is a no-op.

---

## 8. focus(node)

### 8.1 Core: Explicit Focus

FE1. `focus(childB)` — childB gets `focused: true`, old focused node gets
`focused: false`. FE2. `focus(node)` on a non-focusable node raises an error.
FE3. `focus(node)` on the already-focused node is a no-op.

---

## 9. current()

### 9.1 Core: Query

CU1. After `useFocus()`, `current()` returns root. CU2. After `advance()`,
`current()` returns the new focused node. CU3. `current()` never returns
`undefined`.

---

## 10. Focused Node Removal

### 10.1 Core: Advance on Remove

FR1. Remove the focused node. Focus advances to the next node in the chain. FR2.
Remove the last focused node in the chain. Focus wraps to the first. FR3. After
removal, the removed node is gone from the focus chain.

### 10.2 Extended: Edge Cases

FR4. Remove a non-focused focusable node. Focus does not move. FR5. Remove the
only non-root focusable node. Focus returns to root.

---

## 11. Notification

### 11.1 Core: Focus Changes Notify

FN1. `advance()` triggers a tree notification (focus property changes). FN2.
`focusable()` triggers a tree notification (property set). FN3. Multiple focus
operations in one dispatch cycle coalesce into a single notification.

---

## 12. Explicit Non-Tests

The following are explicitly NOT tested:

NT1. Focus trapping / containment (§9.1). NT2. Focus group navigation (§9.2).
NT3. Focus restoration on scope exit (§9.3). NT4. Directional / spatial
navigation (§9.4). NT5. Focus middleware interception patterns (app-level).
