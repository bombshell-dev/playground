import type { ComponentChildren, VNode } from 'preact';
import { useState } from 'preact/hooks';

function SubmitButton({ children, label }: { children: ComponentChildren; label: string }): VNode {
	return (
		<button
			role="button"
			label={label}
			type="submit"
			style={{
				width: '16px',
				height: '3px',
				borderStyle: 'solid',
				borderColor: '#7f7f7f',
				paddingLeft: '1px',
				paddingRight: '1px',
			}}
		>
			{children}
		</button>
	);
}
function FieldRow({ label, width }: { label: string; width: number }): VNode {
	return (
		<div style={{ width: '100%', gap: '1px' }}>
			<div style={{ width: `${width}px` }}>
				<span style={{ color: '#7f7f7f' }}>{label}:</span>
			</div>
			<input role="textbox" label={label} />
		</div>
	);
}
const formStyle = {
	flexDirection: 'column',
	gap: '1px',
	paddingTop: '1px',
	paddingBottom: '1px',
	paddingLeft: '2px',
	paddingRight: '2px',
	minWidth: '32px',
	maxWidth: '44px',
	borderStyle: 'solid',
	borderColor: '#0000ee',
} as const;

// oxlint-disable bombshell-dev/exported-function-async -- Preact components return their tree synchronously.
/** The delivery application reconciles directly into the Clack terminal DOM. */
export function PizzaDelivery(): VNode {
	const [cardOpen, setCardOpen] = useState(false);
	return (
		<div style={{ flexDirection: 'column', width: '100%', height: '100%' }}>
			<form role="form" label="delivery" style={formStyle} onSubmit={() => setCardOpen(true)}>
				<span style={{ color: '#00cdcd' }}>Pizza Delivery</span>
				<FieldRow label="name" width={9} />
				<FieldRow label="address" width={9} />
				<SubmitButton label="add-card">Add card</SubmitButton>
			</form>
			{cardOpen ? (
				<dialog
					role="dialog"
					label="card"
					modal
					style={{
						flexDirection: 'column',
						minWidth: '32px',
						maxWidth: '44px',
						backgroundColor: '#000000',
					}}
				>
					<form
						role="form"
						label="card-payment"
						style={formStyle}
						onSubmit={() => setCardOpen(false)}
					>
						<span style={{ color: '#00cdcd' }}>Card Details</span>
						<FieldRow label="card-number" width={13} />
						<FieldRow label="expiry" width={13} />
						<FieldRow label="cvc" width={13} />
						<SubmitButton label="submit-card">Submit card</SubmitButton>
					</form>
				</dialog>
			) : null}
		</div>
	);
}
