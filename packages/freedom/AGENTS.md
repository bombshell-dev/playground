# AGENTS.md

## Spec-driven development

- Specs in `specs/` are the source of truth. Code conforms to specs, not the
  other way around.

- Never add, remove, or change a public API (interfaces, operations, context
  APIs) in code without first updating the relevant spec and getting explicit
  approval from the user. This includes changes to `Node`, `Tree`, `FreedomApi`,
  `DispatchApi`, `FocusApi`, and any future spec'd interfaces.

- The workflow is: propose the spec change, wait for approval, then implement.
  Do not combine spec changes with implementation in a single step.

## Effection patterns

- Never use `sleep(0)` for synchronization. If you need to coordinate between
  tasks, use `withResolvers()` from Effection.

- Structured concurrency handles cleanup. Do not add explicit "alive" guards,
  flags, or checks for whether a scope has been destroyed. When a scope exits,
  its signals are inert and its tasks are halted.

- Do not reimplement middleware. If the spec says `createApi`, use `createApi`
  and its `around()` method. Do not maintain a parallel list of handlers.

- When delegating `[Symbol.iterator]`, bind directly:
  `[Symbol.iterator]: source[Symbol.iterator]` — not a wrapper generator.

- Effection methods are pre-bound. Do not use `.bind()` when assigning them —
  just assign directly: `child.remove = task.halt`.

## Naming conventions

- API interfaces are named for the domain: `Freedom`, `Dispatch`.
- API constants are the interface name suffixed with `Api`: `FreedomApi`,
  `DispatchApi`.
- Always export both the interface and the API constant.
- Effection resources use the `useX()` naming convention, not `createX()`. For
  example: `useTree()`, not `createTree()`.

## State

- Do not use module-level mutable state (counters, maps, etc.). Scope state to
  the resource or tree that owns it.

## Testing

- Tests should not need to know internal IDs. If a test needs a node reference,
  get it from the tree structure or from the return value of `append`.
- Use `node.eval()` to run operations in a node's scope from tests. Do not rely
  on component bodies having run by the time `createTree` returns.
- Each test file tests exactly one spec. `freedom.test.ts` tests
  `freedom-spec.md`. `focus.test.ts` tests `freedom-focus-spec.md`. Do not put
  tests for one spec into another spec's test file.
