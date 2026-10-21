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
Disabled fieldsets honor the first-legend exception. There is no CSS visibility,
geometry, platform focus preference, browsing-context, or modal-dialog model.

Logical Tab order sorts positive `tabindex` values within each document,
shadow-host, and slot scope, then flattens those scopes. Zero/default values keep
tree order within their scope. Negative scope owners omit their subtree from
sequential navigation while allowing programmatic focus. Navigation wraps within
the document. Shadow delegation preserves an existing delegate and respects
nested delegation boundaries. Browser chrome, popover/navigation-context scopes,
radio-group behavior, and platform focus preferences remain unfinished.

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
`KeyboardEvent` objects. Uncanceled Tab performs explicit logical navigation.
The DOM event remains untrusted. Dispatching a keyboard or focus event directly
never performs focus navigation, text editing, activation, or other default
actions. Byte decoding belongs to the host.

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

Form submission, validity, input-type-specific value sanitization beyond newline
handling, native editing actions, and select/option value models are unfinished.
No caret geometry, painting, or terminal width calculation is included.
