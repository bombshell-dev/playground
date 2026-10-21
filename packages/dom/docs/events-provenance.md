# Events: references and boundaries

The event implementation is independently authored. No LinkeDOM implementation is
transplanted. Its regression requirements were checked against the read-only
[`@clack/ui` baseline](https://github.com/bombshell-dev/ui/blob/606675f16131c6ae7c4553a67ab477bdf661f772/packages/ui/src/dom.ts)
at `606675f16131c6ae7c4553a67ab477bdf661f772`, including `dom.test.ts`. The pinned
source was inspected through `git show` in the existing local checkout.

The [WHATWG DOM event dispatch and invoke algorithms](https://dom.spec.whatwg.org/#concept-event-dispatch)
govern phase order, callback receivers, cancellation, registration removal,
per-invocation snapshots, cleanup, and listener exception handling. In particular,
target capture and target non-capture are separate invocations: a propagation
stop during target capture prevents the non-capture invocation. Additions can
join a later invocation but cannot join the current snapshot. Cancellation
persists on reuse; stop flags do not.

Relevant WPT cases inspected:

- [`Event-dispatch-order.html`](https://github.com/web-platform-tests/wpt/blob/master/dom/events/Event-dispatch-order.html): ancestor capture precedes target delivery and ancestor bubbling.
- [`EventTarget-dispatchEvent.html`](https://github.com/web-platform-tests/wpt/blob/master/dom/events/EventTarget-dispatchEvent.html): active events reject redispatch; listener exceptions are reported while delivery continues.
- [`event-composed-path.html`](https://github.com/web-platform-tests/wpt/blob/master/shadow-dom/event-composed-path.html), [`event-composed.html`](https://github.com/web-platform-tests/wpt/blob/master/shadow-dom/event-composed.html), and [`event-with-related-target.html`](https://github.com/web-platform-tests/wpt/blob/master/shadow-dom/event-with-related-target.html): open/closed visibility, shadow boundaries, and related-target retargeting.

The local tests independently exercise these cases and additional registration,
abort, passive, object-listener, mutation-during-dispatch, and reuse scenarios.

An additional [Vitest adapter](../test/wpt-events.test.ts) executes all 20 cases
from three unchanged upstream WPT files: `AddEventListenerOptions-once.any.js`,
`AddEventListenerOptions-passive.any.js`, and
`AddEventListenerOptions-signal.any.js`. They are pinned to commit
`b4b303c8dca22989c43e2d76fce199c36d4b77a7` with the upstream BSD license and
[provenance](../test/wpt/README.md). Every case passes; none are skipped.
These tests found and corrected options-dictionary conversion occurring too
late for null listeners and acceptance of invalid null abort signals. This is
a selected upstream run, not a run of the complete WPT browser harness.

## Deliberate corrections to the baseline

The baseline allows listener exceptions to escape `dispatchEvent`, terminating
delivery. This package reports them through the document/target error reporter,
continues delivery, and returns the cancellation result. The standalone default
reports an uncaught exception in a microtask; hosts can supply `reportError`.
`stopImmediatePropagation()` sets both stop flags. Event dispatch has its own
active flag, including before listener invocation, rather than inferring it from
`eventPhase`. Neither listener registration nor dispatch requests a host frame.

## Current scope

`Event`, `CustomEvent`, `FocusEvent`, and `KeyboardEvent` are synthetic event
classes; `isTrusted` is always false. Keyboard events expose key/code, location,
the four primary modifiers, repeat, and composition status. They do not execute
browser default actions. Legacy `initEvent`, UIEvent view/detail, legacy keyCode,
mouse/pointer events, activation behavior, and window-global `event` are not
implemented. Tree hooks capture retargeting and closed-root information with
the event path. Targeted tests cover open/closed and nested closed roots,
non-bubbling composed host delivery, related-target trimming, slotted light-tree
events, and mutation-stable retargeting. This is not a claim that all shadow WPT
cases pass. Native `AbortSignal.any()` supplies a private dependent signal so
listener removal survives propagation stops on the source signal's abort event.
