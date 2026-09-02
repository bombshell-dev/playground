import { fixed, grow, rgba } from '@bomb.sh/tty';
import type { ComponentChildren, VNode } from 'preact';
import { useState } from 'preact/hooks';

const black = rgba(0, 0, 0);
const blue = rgba(0, 0, 238);
const cyan = rgba(0, 205, 205);
const gray = rgba(127, 127, 127);

interface SubmitButtonProps {
  children: ComponentChildren;
  label: string;
}

function SubmitButton({ children, label }: SubmitButtonProps): VNode {
  return (
    <button
      role="button"
      label={label}
      type="submit"
      layout={{
        width: fixed(16),
        height: fixed(3),
        padding: { top: 1, right: 1, bottom: 1, left: 1 },
      }}
      border={{ color: gray, top: 1, right: 1, bottom: 1, left: 1 }}
    >
      {children}
    </button>
  );
}

interface FieldRowProps {
  label: string;
  labelWidth: number;
}

function FieldRow({ label, labelWidth }: FieldRowProps): VNode {
  return (
    <box layout={{ direction: 'ltr', gap: 1, width: grow() }}>
      <box layout={{ width: fixed(labelWidth) }}>
        <text color={gray}>{label}:</text>
      </box>
      <input role="textbox" label={label} />
    </box>
  );
}

/** Pizza delivery expressed as a Preact tree over the clack/ui Host. */
export function PizzaDelivery(): VNode {
  const [cardOpen, setCardOpen] = useState(false);

  return (
    <box layout={{ direction: 'ttb', width: grow(), height: grow() }}>
      <form
        role="form"
        label="delivery"
        onSubmit={() => setCardOpen(true)}
        layout={{
          direction: 'ttb',
          gap: 1,
          padding: { top: 1, right: 2, bottom: 1, left: 2 },
          width: grow(32, 44),
        }}
        border={{ color: blue, top: 1, right: 1, bottom: 1, left: 1 }}
      >
        <text color={cyan}>Pizza Delivery</text>
        <FieldRow label="name" labelWidth={9} />
        <FieldRow label="address" labelWidth={9} />
        <box layout={{ direction: 'ltr', gap: 1, width: grow() }}>
          <SubmitButton label="add-card">Add card</SubmitButton>
        </box>
      </form>

      {cardOpen ? (
        <dialog
          role="dialog"
          label="card"
          modal={true}
          layout={{ direction: 'ttb', width: grow(32, 44) }}
          bg={black}
          border={{ color: blue, top: 1, right: 1, bottom: 1, left: 1 }}
          floating={{
            attachTo: 'parent',
            attachPoints: { element: 'center-center', parent: 'center-center' },
            zIndex: 1,
          }}
        >
          <form
            role="form"
            label="card-payment"
            onSubmit={() => setCardOpen(false)}
            layout={{
              direction: 'ttb',
              gap: 1,
              padding: { top: 1, right: 2, bottom: 1, left: 2 },
              width: grow(),
            }}
          >
            <text color={cyan}>Card Details</text>
            <FieldRow label="card-number" labelWidth={13} />
            <FieldRow label="expiry" labelWidth={13} />
            <FieldRow label="cvc" labelWidth={13} />
            <box layout={{ direction: 'ltr', gap: 1, width: grow() }}>
              <SubmitButton label="submit-card">Submit card</SubmitButton>
            </box>
          </form>
        </dialog>
      ) : null}
    </box>
  );
}
