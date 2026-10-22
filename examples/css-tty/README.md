# `@examples/css-tty`

CSS + `@media` queries driven by terminal capabilities: a `@bomb.sh/dom`
document is snapshotted into `@bomb.sh/css`, whose environment is built from
`@bomb.sh/tty`'s capability maps.

```
detectTerminal() ──▶ createTerm({ terminfo })
                          │  scan() events ─▶ term.update(events)
                          ▼                   (capability events fold in)
                  term.capabilities ──▶ environmentFromCapabilities(caps, size) ──▶ env
                          │                                                    │
computeTree(sheet, { nodes, parents, env }) ◀───────────────────────────────────┘
```

`@bomb.sh/dom` has no run loop by design — frame scheduling belongs to
consumers — so the demo owns a minimal one (probe window, repaint on
resize, Ctrl-C exit). Real applications get the loop from the platform:
`@clack/ui`'s `createUI().main()` mounts roots and drives frames for them.

## The wiring

| Terminal capability          | CSS surface                                      |
| ---------------------------- | ------------------------------------------------ |
| columns / rows               | `env.viewportWidth` / `Height` (8×16px per cell) |
| probed background color      | `env.colorScheme` (background luminance)         |
| host motion switch           | `env.reducedMotion` (terminals expose none)      |
| cell aspect                  | `env.resolution: 1`                              |
| color depth, kitty protocols | root custom properties via `capabilityVariables` |

The capability map is `term.capabilities` — the merged view `@bomb.sh/tty`
maintains as `scan()` events flow through `term.update()` (the full events
array passes straight through). The demo folds nothing itself.

Two paths carry capabilities into values:

- **`@media`** reads the environment record: `@media (min-width: 80ch)`
  flips the board to two columns (1ch = 8px, so `80ch` = 80 columns),
  `@media (orientation: …)` picks the main axis, and
  `@media (prefers-reduced-motion: reduce)` responds to the host switch.
- **`light-dark()`** resolves at computed-value time against the color
  scheme derived from the probed background. Resolution covers `color` and
  `*-color` properties, so the stylesheet uses `background-color` and
  `border-color` rather than the shorthands.

## Run

```
pnpm --filter @examples/css-tty demo
```

With a TTY the demo probes the terminal (raw-mode stdin for ~250ms), folds
the responses into the capability map, and re-evaluates the `@media` queries
on every resize; Ctrl-C exits. Piped, it performs one evaluation with the
static capabilities and a dark fallback scheme.

## Test

```
pnpm --filter @examples/css-tty test
```

The suite covers the adapter in isolation and the stylesheet's behavior
through the real engine: the 80ch breakpoint flip, the orientation axis,
the motion switch, `light-dark()` under both schemes, and the computed-value
drop for malformed inline calls.
