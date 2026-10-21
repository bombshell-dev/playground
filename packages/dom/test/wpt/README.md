# Selected upstream Web Platform Tests

These files are unmodified source copies from `web-platform-tests/wpt`, commit
`b4b303c8dca22989c43e2d76fce199c36d4b77a7`:

- [`dom/events/AddEventListenerOptions-once.any.js`](https://github.com/web-platform-tests/wpt/blob/b4b303c8dca22989c43e2d76fce199c36d4b77a7/dom/events/AddEventListenerOptions-once.any.js)
- [`dom/events/AddEventListenerOptions-passive.any.js`](https://github.com/web-platform-tests/wpt/blob/b4b303c8dca22989c43e2d76fce199c36d4b77a7/dom/events/AddEventListenerOptions-passive.any.js)
- [`dom/events/AddEventListenerOptions-signal.any.js`](https://github.com/web-platform-tests/wpt/blob/b4b303c8dca22989c43e2d76fce199c36d4b77a7/dom/events/AddEventListenerOptions-signal.any.js)

Copyright © web-platform-tests contributors. The upstream BSD 3-Clause license
is retained in [LICENSE.txt](./LICENSE.txt). The `.txt` suffix keeps fixtures
outside TypeScript compilation and formatting; it does not change their bytes.

`../wpt-events.test.ts` executes every case in these three files inside a Node VM
context. A minimal adapter maps `test`, `async_test`, and their assertions to
Vitest. It supplies this package's Event/EventTarget and Node's native abort
constructors. Errors reported by listeners are checked explicitly so swallowed
assertions cannot create false passes. TypeError is supplied from the same realm
as the implementation so constructor assertions test the intended exception.

There are no skipped cases in these files. This is a selected upstream run,
not a run of the complete WPT harness or browser suite. Browser document/window
dispatch, trusted events, activation, and the complete shadow event test suite
remain outside this adapter.
