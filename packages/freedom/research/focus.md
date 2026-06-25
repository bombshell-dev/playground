# Focus Management Systems: Research Summary

## Universal Principles

Across web, TUI, game UI, and mobile paradigms, focus management converges on:

1. **Focus is always a singleton.** Exactly one node receives input at any time.
2. **Two levels of navigation.** Nearly every system distinguishes _between
   groups_ (Tab) from _within groups_ (arrows).
3. **Scoping enables composition.** Without focus scopes, every focusable
   element competes in a single flat order. Scopes let subtrees manage focus
   independently (dialogs, menus, panels).
4. **Restoration is universally needed.** When a focus scope closes (modal
   dismiss, node removal), every system needs a strategy for where focus goes.
   Dominant pattern: remember what was focused before the scope activated.
5. **Focus lifecycle is tightly coupled to component lifecycle.** When a focused
   node unmounts, focus must move somewhere — this is a source of bugs in every
   framework.

---

## Web/DOM Focus Management

### Native Focus Model (WHATWG HTML Spec)

**Focusable Areas**: Regions that can receive keyboard input — elements with
non-null tabindex, natively focusable elements (buttons, inputs, links), image
map shapes, scrollable regions, and document viewports.

**Tabindex Processing Model**:

- Null/omitted: UA determines focusability per platform conventions
- Negative integer: Programmatically focusable via `.focus()` but excluded from
  sequential tab navigation
- Zero: Focusable and sequentially navigable; position follows DOM tree order
- Positive integer: Creates explicit ordering (discouraged by spec)

**Focus Navigation Scopes**: Each Document, shadow host, slot element, and
showing popover is a scope owner. The flattened tabindex-ordered focus
navigation scope is computed by recursively inlining child scope contents after
their scope owners.

**Shadow DOM**: Shadow hosts are scope owners. `delegatesFocus: true` delegates
focus to the first focusable descendant.

**Focus Events**: `focus`/`blur` do not bubble. `focusin`/`focusout` do bubble.
Events fire along the focus chain.

**Focus Navigation Start Point** (per Sarah Higley): When a focused element is
removed from the DOM, browsers maintain a "sequential focus navigation starting
point" at the removed element's former position. Screen readers largely ignore
this mechanism.

### ARIA Focus Management Patterns (W3C APG)

**Roving Tabindex**: Manages focus in composite widgets (radio groups, tablists,
toolbars, trees, grids):

1. Set `tabindex="0"` on active element, `tabindex="-1"` on siblings
2. On arrow key: old element → `-1`, new element → `0`, call `.focus()`
3. Browser automatically scrolls newly focused element into view

**aria-activedescendant**: Keeps DOM focus on container while logically pointing
to active child. Critical limitations (per Sarah Higley):

- Purely a screen reader construct; no effect on keyboard events or DOM focus
- No automatic scroll-into-view
- VoiceOver Safari macOS essentially ignores it
- Mobile screen readers bypass it entirely
- Best suited for comboboxes only

**Focus traps** (modals/dialogs): Intercept Tab at boundaries and wrap. Requires
initial focus, wrapping Tab/Shift+Tab at boundaries, and focus restoration on
close.

### Open UI `focusgroup` Proposal

The most ambitious standardization attempt:

- Arrow-key navigation within a declared subtree, guaranteed tab stop, automatic
  last-focused memory
- Crosses shadow DOM boundaries by default; `focusgroup=none` opts out
- **Independence principle**: Nested `focusgroup` exits ancestor's group; each
  element belongs to exactly one focusgroup
- Values: empty (linear), `grid`, `manual-grid`, `none`
- Modifiers: `inline`/`block` (direction), `wrap`/`flow` (boundary), `no-memory`
- Grid navigation: `row-wrap`, `col-wrap`, `row-flow`, `col-flow`

---

## React Focus Management

### React Aria FocusScope (Adobe)

Three declarative props:

- **`contain`**: Prevents focus from leaving scope; Tab wraps at boundaries
- **`restoreFocus`**: Stores `document.activeElement` on mount; restores on
  unmount
- **`autoFocus`**: Focuses first focusable descendant on mount

`useFocusManager()` hook: `focusNext({wrap})`, `focusPrevious({wrap})`,
`focusFirst()`, `focusLast()`.

Implementation uses sentinel nodes as boundary markers in the DOM.

### react-focus-lock (theKashey)

- **No keyboard event interception**: Watches focus behavior via `focus` events,
  not `keydown`
- `data-focus-lock=[group-name]` for scattered focus groups/shards (critical for
  portals)
- Core `focus-lock` package is 1.5kb

### Radix UI FocusScope

- Tab interception only at boundaries (native browser handles mid-scope)
- `TreeWalker`-based element discovery
- Container gets `tabIndex={-1}` as fallback
- Focus scope stack: parent paused when child activates, resumes on child
  unmount

### React Issue #16009 — Rethinking Focus

- Collecting focusable elements is O(n), measured at 850ms on Android Chrome
- Proposed ID-based focus with propagating lookups through nested scopes
- Cross-platform abstraction independent of DOM

---

## Terminal/TUI Focus Management

### Textual (Python) — Most Complete TUI System

- **Opt-in**: `can_focus` (default `False`) and `can_focus_children` (default
  `True`)
- **Focus chain**: Computed ordered list of all focusable widgets; Tab/Shift+Tab
  traverse it
- **`can_focus_children=False`**: Skips children during Tab navigation
  (primitive containment)
- **Programmatic**: `focus_next()`, `focus_previous()`, `widget.focus()`,
  `set_focus()`
- **Events**: `Focus`, `Blur`, `DescendantFocus`, `DescendantBlur`
- **CSS**: `:focus` pseudo-class, `has_focus_within` property
- **Scroll**: `focus(scroll_visible=True)`

### Ink (React for terminals)

- `useFocus()` hook makes component focusable; returns `{isFocused}`
- `useFocusManager()`: `focusNext()`, `focusPrevious()`, `focus(id)`
- Focus order follows render order
- No focus scoping — focus is global

### Bubble Tea (Go)

- Terminal-level only: `FocusMsg`/`BlurMsg` for window focus
- Component focus is entirely DIY via `focusIndex` integer
- Community `bubbletea-nav`: flat `FocusManager` with Tab/Shift+Tab

### Ratatui (Rust)

- No built-in focus; community crates: `rat-focus` (FocusFlag + FocusBuilder),
  `ratatui-interact` (FocusManager), `focusable` (derive macro)

### Common TUI Pattern

All converge on: flat ordered list of focusable widgets, Tab/Shift+Tab
navigation. None have built-in focus scoping or containment. Focus ordering is
explicit (manual index) or render/mount order.

---

## Game UI / Spatial Focus

### Unity UI Navigation

Four modes per `Selectable`:

- **Automatic**: Spatial proximity-based neighbor computation
- **Explicit**: Manual `selectOnUp/Down/Left/Right` per element
- **Horizontal/Vertical**: Navigation restricted to one axis
- **None**: Disables navigation

### ImGui Navigation

Directional algorithm: collect navigable items, score by distance + direction
alignment, select lowest score. Two NavLayers (Main, Menu). Window-level focus
with cross-window navigation support.

### Microsoft WinUI/UWP 2D Navigation

**XYFocusKeyboardNavigation**: `Auto`, `Enabled`, `Disabled` — creates
directional areas.

Three strategies:

1. **Projection**: Projects focused element's edge in navigation direction
2. **NavigationDirectionDistance**: Extends bounding rect, finds closest to
   navigation axis
3. **RectilinearDistance**: Manhattan distance scoring

**TabFocusNavigation**: `Local` (subtree tab indexes), `Once` (group tab stop),
`Cycle` (wrap within container).

### SwiftUI Focus System

- `@FocusState`: Property wrapper tracking focus (Boolean or Hashable enum)
- `.focused($state, equals:)`: Binds view focus to state variable
- `.defaultFocus()`: Initial focus target when scope appears
- `.focusSection()`: Groups views for directional navigation without making
  section focusable

---

## Focus Ordering Strategies

| Strategy            | Description                                   | Used By                             |
| ------------------- | --------------------------------------------- | ----------------------------------- |
| DOM/tree order      | Source order in document/tree                 | HTML default, Ink, Textual          |
| Explicit tab order  | Numeric index overrides tree order            | HTML `tabindex`, WinUI              |
| Roving within group | Arrows within group, Tab between groups       | ARIA composites, `focusgroup`       |
| Spatial/directional | Nearest element in pressed direction          | WinUI, Unity, ImGui, tvOS           |
| Scope-local         | Tab order computed within scope               | HTML focus scopes, WinUI `Local`    |
| Cycle/wrap          | Focus wraps at boundaries                     | WinUI `Cycle`, FocusScope `contain` |
| Once (group stop)   | Container is single Tab stop; arrows internal | WinUI `Once`, ARIA composites       |
| Render order        | Component render/mount order                  | Ink, Bubble Tea                     |
| Custom/programmatic | Application logic determines order            | All frameworks                      |

---

## Focus Scoping Comparison

| System               | Scoping Mechanism           | Containment              | Restoration            | Nesting                     |
| -------------------- | --------------------------- | ------------------------ | ---------------------- | --------------------------- |
| DOM/HTML             | Focus navigation scopes     | No built-in trap         | No built-in            | Hierarchical via shadow DOM |
| Open UI `focusgroup` | `focusgroup` attribute      | Independent groups       | Last-focused memory    | Nested auto-exits parent    |
| React Aria           | `<FocusScope>`              | `contain` prop           | `restoreFocus` prop    | Parent paused               |
| Radix                | `<FocusScope>`              | `loop` prop              | Stores `activeElement` | Focus scope stack           |
| react-focus-lock     | `data-focus-lock`           | Focus observation        | `returnFocus` prop     | Focus shards                |
| WinUI/UWP            | `XYFocusKeyboardNavigation` | `Cycle` mode             | No built-in            | Inheritance                 |
| SwiftUI              | `@FocusState` + sections    | Sections guide direction | `.defaultFocus()`      | Nestable                    |
| Textual              | `can_focus_children=False`  | Prevents Tab entry       | No built-in            | Widget tree                 |
| ImGui                | Window flags, modals        | Modal windows            | No built-in            | NavLayer                    |

---

## Focus and Lifecycle

### Focused Component Unmount

- **DOM**: `document.activeElement` falls back to `<body>`; navigation start
  point remembered
- **React**: `onBlur` does not fire on parent when React unmounts focused child
- **React Aria**: `restoreFocus` stores previous element, restores on unmount
- **Radix**: Stores `activeElement` before activation, restores on unmount
- **Textual**: `blur()` moves focus to next available widget

### Focus Side Effects

- **Scroll into view**: Browser auto-scrolls on `.focus()` and roving tabindex;
  NOT on `aria-activedescendant`
- **Screen reader**: Focus changes trigger announcement of focused element's
  name and role
- **Focus visible**: `:focus-visible` distinguishes keyboard from mouse/touch
  focus

---

## Sources

- [WHATWG HTML - The tabindex attribute](https://html.spec.whatwg.org/multipage/interaction.html)
- [W3C APG - Keyboard Interface](https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/)
- [Open UI focusgroup Explainer](https://open-ui.org/components/focusgroup.explainer/)
- [React Aria FocusScope](https://react-aria.adobe.com/FocusScope)
- [React Focus Management RFC](https://github.com/devongovett/rfcs-1/blob/patch-1/text/2019-focus-management.md)
- [React Issue #16009](https://github.com/facebook/react/issues/16009)
- [react-focus-lock](https://github.com/theKashey/react-focus-lock)
- [Radix UI FocusScope](https://www.npmjs.com/package/@radix-ui/react-focus-scope)
- [Sarah Higley - aria-activedescendant](https://sarahmhigley.com/writing/activedescendant/)
- [Sarah Higley - Focus navigation start point](https://sarahmhigley.com/writing/focus-navigation-start-point/)
- [Textual Input Guide](https://textual.textualize.io/guide/input/)
- [Ink](https://github.com/vadimdemedes/ink)
- [Bubble Tea](https://github.com/charmbracelet/bubbletea)
- [ImGui Navigation](https://deepwiki.com/ocornut/imgui/2.6-input-and-navigation)
- [WinUI Focus Navigation](https://learn.microsoft.com/en-us/windows/apps/design/input/focus-navigation)
- [Unity UI Navigation](https://learn.unity.com/tutorial/ui-navigation-2019-3)
- [WICG CSS Spatial Navigation](https://github.com/WICG/spatial-navigation)
- [SwiftUI Focus - WWDC23](https://developer.apple.com/videos/play/wwdc2023/10162/)
- [Cloudscape Focus Principles](https://cloudscape.design/foundation/core-principles/accessibility/focus-management-principles/)
