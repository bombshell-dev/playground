# Interactive element standards and differential checks

The element algorithms were checked against the WHATWG HTML living standard
dated 2026-10-26. This is a scoped implementation, not a claim of complete HTML
element or Web Platform Test conformance.

- [Select](https://html.spec.whatwg.org/multipage/form-elements.html#the-select-element)
  and [option](https://html.spec.whatwg.org/multipage/form-elements.html#the-option-element):
  option lists, selectedness and dirtiness, default selection, reset, and disabled
  options/groups. Collections use the package's live read-only array interface;
  the select exposes `item`, `namedItem`, `add`, `remove`, and `length`.
- [Selectedcontent](https://html.spec.whatwg.org/multipage/form-elements.html#the-selectedcontent-element):
  cloning the selected option's contents. These are snapshots: editing an option's
  text does not update the snapshot until another selection update. Removing a
  selected option refreshes its snapshot in a microtask.
- [Output](https://html.spec.whatwg.org/multipage/form-elements.html#the-output-element),
  [progress](https://html.spec.whatwg.org/multipage/form-elements.html#the-progress-element),
  and [meter](https://html.spec.whatwg.org/multipage/form-elements.html#the-meter-element):
  default-value/reset modes and numeric reflection. Setting `progress.max` to a
  nonpositive number leaves its attribute unchanged; setting the content
  attribute directly still uses the getter's fallback.
- [Input](https://html.spec.whatwg.org/multipage/input.html#the-input-element)
  and [DOM event dispatch](https://dom.spec.whatwg.org/#concept-event-dispatch):
  checkedness, activation before listeners, cancellation rollback, and input/change
  notifications. Plain `Event('click')` does not activate a checkbox;
  `MouseEvent('click')` does. These synthetic events remain untrusted.

The unchanged upstream
[`option-selected.html`](https://github.com/web-platform-tests/wpt/blob/b4b303c8dca22989c43e2d76fce199c36d4b77a7/html/semantics/forms/the-option-element/option-selected.html)
contributes three passing tests for pristine and dirty options, alongside the
existing event WPT subset. The pinned source and BSD license are in `test/wpt`.
The upstream
[`selected-index.html`](https://github.com/web-platform-tests/wpt/blob/b4b303c8dca22989c43e2d76fce199c36d4b77a7/html/semantics/forms/the-select-element/selected-index.html)
was also consulted; that complete file is not claimed as passing because it
requires the browser's `HTMLOptionsCollection` API.

## Browser observations

`test/browser/interactive-controls.html` is an independently written development
fixture. Chrome **156.0.8078.73** on macOS matched all **15 recorded browser
expectations** on 2026-10-28. Thirteen agree with the package; two cases explicitly
record different package expectations. The fixture covers checkbox cancellation
and cloning, click event classes, option dirtiness and attributes, output reset,
numeric reflection and stepping, and selectedcontent timing. It neither runs nor
requires a browser in package tests or at runtime.

Run the fixture by opening it in a browser, or use the installed Chrome binary:

```sh
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless --disable-gpu --no-first-run \
  --user-data-dir="$(mktemp -d /tmp/dom-controls.XXXXXX)" \
  --dump-dom "file://$PWD/packages/dom/test/browser/interactive-controls.html"
```

Two observed Chrome differences deliberately follow the current standard:

1. After `select.value` is set to a missing value, assigning `false` to an already
   unselected option asks for a reset in the HTML algorithm and restores the first
   eligible option. Chrome short-circuits that unchanged setter and keeps the
   selection empty. A dedicated unit test preserves the standard reset behavior.
2. When the previously selected radio changes groups during another radio's
   canceled click, the HTML cancellation algorithm unchecks the activated radio.
   Chrome leaves it checked. The package follows the specified rollback rule.

Numeric stepping makes a separate interoperability choice. With `min="0.1"` and
`step="0.2"`, starting at `0.2` and calling `stepUp(2)` yields `0.5`; from `0.5`,
`stepUp(-1)` yields `0.3`. This agrees with the measured browser and honors the
signed step count. The current
[step algorithm](https://html.spec.whatwg.org/multipage/input.html#dom-input-stepup)
literally omits `n` in its mismatch branch and checks direction by method name
without accounting for negative `n`. Those branches are not claimed as literal
specification matches.

## Shadow parsing, cloning, and assignment

`test/browser/shadow-extensions.html` adds **12 browser differential cases**, all
matching Chrome 156.0.8078.73 on 2026-10-28. Run it using the same command above
with `shadow-extensions.html` as the filename. These checks cover:

- [DOM cloning](https://dom.spec.whatwg.org/#concept-node-clone): even a shallow
  host clone deeply copies its clonable shadow tree. Custom-element constructors
  run after the attributes and trees have been copied, so constructors can reuse
  an existing shadow root.
- [Declarative shadow parsing](https://html.spec.whatwg.org/multipage/parsing.html#parsing-main-inhead):
  `innerHTML` preserves ordinary templates. `setHTMLUnsafe` recognizes declarative
  templates beneath newly parsed hosts; a top-level template does not attach a
  root to the fragment's context element.
- [Shadow attachment](https://dom.spec.whatwg.org/#concept-attach-a-shadow-root):
  same-mode hydration reuses and clears the declarative root, preserving its
  flags. A mode mismatch or a second attachment is rejected.
- [HTML serialization](https://html.spec.whatwg.org/multipage/dynamic-markup-insertion.html#html-serialization-methods):
  closed roots are included only through serializable-root or explicit-root
  options. The synthetic template attributes follow the standard's order.
- [Slot assignment](https://html.spec.whatwg.org/multipage/scripting.html#dom-slot-assign):
  manual ordering, transfer, reconnection, prevalidated slottables, removal
  notifications, and the template slot-assignment property's named default.

These are development checks on the supported algorithms. They do not imply
support for scoped custom-element registries, browser layout, or the complete
shadow-tree Web Platform Test suite.
