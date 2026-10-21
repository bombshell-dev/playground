# Source provenance

This package is independently maintained. It does not depend on LinkeDOM or wrap a second DOM tree.

## Bombshell baseline

Read-only reference: [bombshell-dev/ui at `606675f16131c6ae7c4553a67ab477bdf661f772`](https://github.com/bombshell-dev/ui/tree/606675f16131c6ae7c4553a67ab477bdf661f772).

Inspected files: `packages/ui/src/dom.ts`, `dom.test.ts`, `ui.ts`, `packages/ui-preact/src/root.ts`, `root.test.tsx`, `elements.ts`, `jsx-runtime.ts`, and `jsx-dev-runtime.ts`.

The core DOM/event regression tests preserve useful baseline behavior while covering the standards differences below. The upstream license is MIT, copyright (c) 2025-Present Bombshell contributors; its permission notice is retained in this package's LICENSE.

The existing terminal renderer and its dependencies remain consumer concerns. `ui.ts` demonstrates why connected-document invalidation is separate from output scheduling: its consumer requests frames, coalesces them, and awaits writes independently of tree mutation.

## LinkeDOM evaluation

Read-only reference: [WebReflection/linkedom at `e2ee20813e4b3ae946d7ba41621ddf3698431989`](https://github.com/WebReflection/linkedom/tree/e2ee20813e4b3ae946d7ba41621ddf3698431989), inspected 2026-10-21. Upstream is ISC licensed, copyright (c) 2021 Andrea Giammarchi, @WebReflection.

The registry (`esm/interface/custom-element-registry.js`), HTML element constructor (`esm/html/element.js`), template element (`esm/html/template-element.js`), shadow root (`esm/interface/shadow-root.js`), and shared symbols were evaluated as a coherent tree-dependent slice. The registry traverses the linked tree through NEXT/END sentinels and coordinates construction through UPGRADE. It also has module-level constructor and reaction state. Templates coordinate CONTENT/PRIVATE symbols with parsing and cloning. The registry and templates cannot safely be transplanted independently into this package's tree.

No LinkeDOM source has been copied into this package. It supplies design references, not runtime objects. In particular, upstream's upgrade strategy of removing attributes and enumerable properties before construction is not adopted: upgrades must preserve existing identity and user state and queue lifecycle reactions explicitly.

## Standards and test references

- [WHATWG DOM: mutation algorithms](https://dom.spec.whatwg.org/#mutation-algorithms), [event dispatch](https://dom.spec.whatwg.org/#concept-event-dispatch), [mutation observers](https://dom.spec.whatwg.org/#mutation-observers), and [ranges](https://dom.spec.whatwg.org/#ranges).
- [WHATWG HTML: focus](https://html.spec.whatwg.org/multipage/interaction.html#focus), [text-control selection](https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#textFieldSelection), and [custom elements](https://html.spec.whatwg.org/multipage/custom-elements.html).
- [Web Platform Tests: DOM events](https://github.com/web-platform-tests/wpt/tree/master/dom/events), [nodes](https://github.com/web-platform-tests/wpt/tree/master/dom/nodes), [ranges](https://github.com/web-platform-tests/wpt/tree/master/dom/ranges), and [custom elements](https://github.com/web-platform-tests/wpt/tree/master/custom-elements).

The test suite contains focused adaptations and independently written regression tests. It is not the complete WPT suite. Passing it is not a claim of complete DOM or Web Components conformance.

The independently written [custom-element browser differential](../test/browser/custom-elements.html) matches five expectations in `test/components.test.ts`: construction after fragment attributes and descendants exist, construction after connected insertion, inert template parsing, pre-upgrade attribute snapshots, and reentrant per-element reaction queues. All five passed in installed headless Chrome 155 on 2026-10-21. The fixture writes its actual and expected values into the page and sets `#results[data-passed="true"]` when they match. Open it in a browser, or reproduce from the workspace root with an installed Chrome executable:

```sh
DOM_BROWSER='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
"$DOM_BROWSER" --headless --disable-gpu --no-first-run \
  --user-data-dir=/tmp/bomb-dom-browser-validation --dump-dom \
  "file://$PWD/packages/dom/test/browser/custom-elements.html"
```

This is a development check. Neither Chrome nor a browser automation library is a package runtime dependency. The comparison exposed two parser bugs that the regression tests now cover: eager construction before parsed attributes existed and construction inside inert template contents.

## Baseline differences

The baseline automatically creates a `<document>` element. Here document shape is explicit: append a root of the application's choice, including `<document>`. This permits HTML-like, terminal-specific, and detached framework containers without special cases.

Baseline text and attribute nodes inherited unrestricted child insertion; the DOM hierarchy rules reject it. Public collections must not expose the private mutation array. Baseline direct `Attr.value` assignment did not invalidate an attached document; the attribute owner must participate in mutation recording and invalidation. Namespaces cannot be represented by returning the HTML namespace for every node. HTML `tagName` and `nodeName` are uppercase; `localName` remains separate, and `createElementNS` preserves qualified-name case. The baseline exposed a lowercase `tagName`.

The baseline dispatch implementation established capture/target/bubble order, event-path snapshots, registration identity, and the target-capture stop boundary. DOM listener exceptions are reported rather than synchronously escaping `dispatchEvent`; `stopImmediatePropagation` sets both stop flags. Registration options, abort handling, composed-path behavior, and interactive focus require additional implementation beyond that baseline.

Setting character data to the same string may avoid a rendered frame, but standard mutation records remain distinct from frame invalidation. The same distinction applies to explicitly observed detached nodes.
