# Forms and element extensions

`Document.createElement()` constructs actual specialized classes for `input`,
`textarea`, `button`, `form`, `label`, `fieldset`, `legend`, `select`, `option`,
`optgroup`, `datalist`, `selectedcontent`, `output`, `progress`, `meter`, `details`,
`summary`, `dialog`, `template` and `slot`. Arbitrary names use the common Element
base unless the document registers an application factory.

## Forms without network submission

```ts
import { Document, FormDataEvent, SubmitEvent } from '@bomb.sh/dom';

const document = new Document();
const form = document.createElement('form');
const name = document.createElement('input');
name.name = 'name';
name.required = true;
const submit = document.createElement('button');
submit.textContent = 'Continue';
form.append(name, submit);
document.append(form);

form.addEventListener('submit', (event) => {
	if (event instanceof SubmitEvent) console.info(event.submitter);
});
form.addEventListener('formdata', (event) => {
	if (event instanceof FormDataEvent) console.info([...event.formData]);
});
name.value = 'Ada';
form.requestSubmit(submit); // Validation → submit → formdata; no network request.
```

Controls resolve their form through ancestors or an explicit `form` ID in a
connected document. Moving controls, changing IDs, and adoption update association.
Labels resolve their control through `for` or a nested labelable element. Disabled
fieldsets exclude descendants except those inside the first legend. Collections
are live, protected arrays; they do not claim the browser's complete
HTMLFormControlsCollection or HTMLOptionsCollection interface.

`checkValidity()` and `reportValidity()` dispatch cancelable `invalid` events;
reporting focuses an eligible uncanceled invalid control. There is no browser
validation popup. Validity covers the implemented required/type/pattern/length/
min/max/step constraints plus custom errors. Invalid values can still be assigned
by application code. Minimum/maximum text length validity applies to user edits.

`requestSubmit()` validates and sends a cancelable `SubmitEvent`. `submit()` bypasses
validation and that event. Both construct an entry list and send `FormDataEvent`.
`method="dialog"` closes the ancestor dialog after collecting entries. Canceling
`submit` prevents those subsequent actions. Submitting a disconnected form does
nothing. `reset()` sends a cancelable reset event and restores defaults without
synthesizing input/change events. `new FormData(form, submitter)` can collect entries
independently; it uses the host's actual FormData/Blob implementation (Node 22 in
this workspace). Reentrant entry collection is rejected.

Input/textarea dirty values and checkedness are distinct from attributes/defaults.
Checkbox click activation happens before listeners and rolls back when canceled.
Radio groups share a nonempty name, form owner and tree; cloned controls preserve
current values, checkedness, dirty flags and input indeterminateness. Numeric/date
input types support applicable `valueAsNumber`, `valueAsDate`, `stepUp` and `stepDown`.
Programmatic changes invalidate connected state but do not synthesize input/change.
See [focus and controls](focus-and-controls.md) for host editing and selection.

File-input files/selection, picker UI, numeric editor display state (`badInput`),
modern color alpha/color-space handling, form-associated custom elements,
submission encoding/navigation, and complete HTML control properties are unfinished
or outside the package's scope. No file-selection API or browser window is claimed.

## Choices and calculated values

```ts
const select = document.createElement('select');
select.name = 'mode';
for (const value of ['quick', 'thorough']) {
	const option = document.createElement('option');
	option.value = value;
	option.text = value;
	select.add(option);
}
form.append(select);
select.value = 'thorough';
select.focus();
document.dispatch.select([0]); // Explicit host selection, with input/change events.

const output = document.createElement('output');
output.defaultValue = 'Ready';
output.value = 'Running';
form.append(output);
form.reset(); // Restores output to Ready, alongside the other controls.
```

Single and multiple selects preserve option selectedness and dirtiness through
mutation, cloning, reset and adoption. Disabled options/groups are excluded from
host selection and form entries. `selectedcontent` mirrors selected option contents
as snapshots; it is not a general live cloning facility. Datalist exposes options
without a popup. Output exposes default/current values and `htmlFor` tokens.
Progress supports determinate/indeterminate position; meter clamps its numeric
range and thresholds. Painting is the renderer's responsibility.

## Templates and shadow composition

```ts
import { installParsing } from '@bomb.sh/dom/parsing';
installParsing(document);
const container = document.createElement('div');
container.setHTMLUnsafe(`
  <section>
    <template shadowrootmode="open" shadowrootclonable shadowrootserializable>
      <slot></slot>
    </template>
    Light content
  </section>
`);
console.info(container.getHTML({ serializableShadowRoots: true }));
```

`innerHTML` keeps shadow templates inert. `setHTMLUnsafe` explicitly enables
declarative shadow parsing for hosts inside the parsed fragment; a top-level
template does not attach a root to the existing context element. There is no
sanitizer, and scripts remain inert. A same-mode `attachShadow` on a declarative
root clears it and returns the same root for hydration. Clonable roots copy their
shadow descendants even when the host clone is shallow. `getHTML` includes roots
only when requested through `serializableShadowRoots` or an explicit `shadowRoots`
list. Ordinary serialization omits them.

```ts
const host = document.createElement('box');
const shadow = host.attachShadow({ mode: 'open', slotAssignment: 'manual' });
const slot = document.createElement('slot');
shadow.append(slot);
const first = document.createElement('text');
const second = document.createTextNode('second');
host.append(first, second);
slot.assign(second, first); // Assignment order; light-tree order stays unchanged.
```

Manual assignments use weak references and survive removal/reinsertion of the
assigned node. Changing connected composition invalidates the host renderer and
queues slotchange without inventing a tree mutation record. The package permits
HTML terminal names as shadow hosts; this deliberately extends the browser's
restricted valid-shadow-host-name list. SVG/MathML shadow hosts are rejected.
Scoped registries, ElementInternals and the complete shadow/custom-element
specification remain unfinished.

Custom-element reactions belong to document-keyed weak state. Mutations share a
bounded local queue across participating documents and drain it in `finally`;
direct parser calls also own a scope, including failed parsing. Backup reactions
receive their own microtask. There is no module-global strong pending-element
queue that waits for an unrelated document mutation.
