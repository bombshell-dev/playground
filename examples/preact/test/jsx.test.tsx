import { Document, type Element, Event } from '@bomb.sh/dom';
import { createRef } from 'preact';
import { expect, it } from 'vitest';
import { createRoot } from '../src/index.ts';

it('types JSX refs and listeners against the public host declarations', () => {
	const document = new Document();
	const container = document.createElement('box');
	const ref = createRef<Element>();
	const events: Event[] = [];
	using root = createRoot(container);
	root.render(
		<text
			ref={ref}
			onClick={(event) => {
				events.push(event);
			}}
		>
			hello
		</text>,
	);
	ref.current?.dispatchEvent(new Event('click'));
	expect(events).toHaveLength(1);
	expect(ref.current?.textContent).toBe('hello');
});
