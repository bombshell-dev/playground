# Focus and text controls

Each `Document` owns its own `FocusManager` and `Dispatch`. `element.focus()`
moves logical focus; `blur()` releases it. `document.activeElement` retargets
shadow focus to the host, while `shadowRoot.activeElement` exposes the focused
element in that root. `document.focusManager.activeElement` is the deepest
focused element, useful to input drivers. With no explicit focus, a document's
`activeElement` falls back to its body or root element.

Focus transitions deliver `blur`, `focusout`, `focus`, and `focusin`, carrying
the opposite element as `relatedTarget`. Repeated focus is a no-op. Removal
clears focus without generating blur events. Nested transitions supersede stale
outer transitions. Focus changes invalidate the connected document.

The implementation follows the
[HTML focus processing model](https://html.spec.whatwg.org/multipage/interaction.html#focus-update-steps)
where applicable to a headless environment. Eligibility includes native controls,
links with `href`, valid `tabindex`, and editable elements. Disconnected,
hidden, inert, disabled, and hidden-type input elements cannot receive focus.
Disabled fieldsets honor the first-legend exception. Closed dialogs and collapsed
details content are excluded; a details element's first summary remains eligible.
An open modal dialog makes the rest of its document logically inert. There is no
CSS visibility, geometry, platform focus preference, or browsing-context model.

Logical Tab order sorts positive `tabindex` values within each document,
shadow-host, and slot scope, then flattens those scopes. Zero/default values keep
tree order within their scope. Negative scope owners omit their subtree from
sequential navigation while allowing programmatic focus. Navigation wraps within
the document, restricted to the topmost modal dialog when one is present. Shadow
delegation preserves an existing delegate and respects nested delegation boundaries.
Autofocus runs in a queued task after connection, once per document, and preserves
focus that was explicitly placed before that task. Dialog opening independently
honors autofocus. Named radio groups contribute their checked member to sequential
navigation, or their first eligible member when unchecked. Browser chrome,
popover/navigation-context scopes and platform focus preferences remain unfinished.

```ts
import { Document, Dispatch } from '@bomb.sh/dom';

const document = new Document();
const box = document.createElement('box');
const input = document.createElement('input');
const button = document.createElement('button');
document.append(box);
box.append(input, button);

input.focus();
const dispatch = new Dispatch(document);
dispatch.keydown({ key: 'Tab' }); // Routes keydown to input, then focuses button.
dispatch.keyup({ key: 'Tab' }); // Routes keyup to the newly focused button.
```

`Dispatch.keydown()` and `keyup()` accept host data and construct synthetic
`KeyboardEvent` objects. Uncanceled Tab performs logical navigation. Enter activates
buttons and summaries; Space activates buttons, summaries, checkboxes, and radios
on an uncanceled matching keyup. Radio arrow navigation changes the focused and
checked member. Select arrow/Home/End keys skip disabled options. Escape requests
closure of the topmost eligible dialog. Text-input Enter commits a pending change
and applies implicit form submission. The generated events remain untrusted.
Dispatching a keyboard or focus event directly never performs these host actions.
Byte decoding belongs to the host.

Host typing and `dispatch.insertText(text)` edit selection-capable inputs and
textareas. `beforeinput` can cancel the edit; a successful edit emits `input`.
Readonly and disabled controls reject editing. Host insertion honors `maxlength`;
script assignments remain unrestricted. Control edits emit `change` on blur or
input Enter when the value has changed since the edit session began. Programmatic
assignments do not independently start an edit session.

Left/Right, Backspace, and Delete use grapheme boundaries while all exposed offsets
remain UTF-16 code units. Shift extends selection, Home/End go to the start/end of
the value, and Ctrl/Meta+A selects it. Textarea Enter inserts a line break. The host
can call `dispatch.select(indices)` to commit an option selection from its own picker.
IME composition orchestration, clipboard access, visual-line movement, and editing
non-selection input types such as number/date/email remain unfinished.

```ts
input.focus();
document.dispatch.insertText('hello');
document.dispatch.keydown({ key: 'ArrowLeft', shiftKey: true });
document.dispatch.insertText('!');
```

Connected `contenteditable` and `plaintext-only` editing hosts also accept host text
insertion, range replacement, selection movement, deletion, and plaintext line
breaks. Their caret is the document's live `Selection`; mixed text/element boundary
points work without replacing the entire subtree. Input events target the editing
host. As an explicit conservative editing policy, edits whose selected range
intersects a `contenteditable=false` island are rejected. Rich-text formatting,
atomic deletion of noneditable widgets, HTML paragraph creation, and editable
selection inside shadow trees are unfinished. This is a defined plaintext editing
subset, not a browser editing-engine compatibility claim.

Input and textarea value selection is separate from document `Selection`.
The [HTML text selection algorithms](https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#textFieldSelection)
define UTF-16 offsets, clamping, direction, and replacement modes. The package
implements `selectionStart`, `selectionEnd`, `selectionDirection`, `select()`,
`setSelectionRange()`, and `setRangeText()`. Input types without text selection
return null selection properties and reject selection setters. Textareas
normalize CRLF; text inputs remove newlines. Dirty values stay separate from
default values. Selection events are queued as tasks and host invalidation is
synchronous. Programmatic value changes do not fire input/change events.

```ts
input.value = 'a😀b';
input.setSelectionRange(1, 3, 'forward'); // The emoji occupies two UTF-16 units.
input.setRangeText('x', 1, 3, 'select');
```

Cloning and importing copy text-control values and dirty-value flags, following
the HTML [input cloning](https://html.spec.whatwg.org/multipage/input.html#the-input-element)
and [textarea cloning](https://html.spec.whatwg.org/multipage/form-elements.html#the-textarea-element)
steps. Clones have their own selection and focus state; caret positions and
listeners are not copied. A shallow pristine textarea clone retains the current
value despite having no default-value children. Moving/adopting the existing
element preserves its selection and value.

Details and dialogs follow the state/event algorithms in the
[HTML interactive elements specification](https://html.spec.whatwg.org/multipage/interactive-elements.html).
Details `open` changes queue a coalesced `ToggleEvent`; a nonempty `name` enforces
one open member per tree. Canceling a summary's click prevents its toggle. Dialog
`show()`/`showModal()` send cancelable opening `beforetoggle`, focus an autofocus
candidate, the first eligible descendant, or the dialog itself, and queue `toggle`.
`requestClose()` sends cancelable `cancel`; `close()` bypasses cancellation, updates
`returnValue`, restores applicable prior focus, and queues `close`. Closing
`beforetoggle` is not cancelable. Nested modal dialogs have independent focus
restoration, and removing a dialog subtree releases modal state, including shadow
descendants. State is owned by document-keyed weak maps.

```ts
const dialog = document.createElement('dialog');
const accept = document.createElement('button');
accept.textContent = 'Accept';
accept.addEventListener('click', () => dialog.close('accepted'));
dialog.append(accept);
box.append(dialog);
dialog.showModal();
```

One intentional standards surprise: removing a modal dialog's `open` attribute
directly does not release its modal blocking. Use `close()` or remove the dialog.
`closedBy` controls host Escape requests; an explicit `requestClose()` ignores it.
Pointer light-dismiss, popovers, browser CloseWatcher activation-history policy,
caret geometry, painting, and terminal width calculation are outside this tested
scope.
