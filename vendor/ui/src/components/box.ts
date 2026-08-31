import { open as ttyOpen, type OpenElement, type Op, close as ttyClose } from '@bomb.sh/tty';
import { type Child, normalizeChildren } from '../children.ts';

/** Box props — a 1:1 passthrough to the tty `open` op, plus an optional `key` for identity across renders. */
export type BoxProps = Omit<OpenElement, 'directive' | 'id'> & { key?: string };

export function box({ key, ...props }: BoxProps, ...children: Child[]): Op[] {
	return [ttyOpen(key ?? '', boxPropsToOps(props)), ...normalizeChildren(children), ttyClose()];
}

function boxPropsToOps(
	props: Omit<OpenElement, 'directive' | 'id'>,
): Omit<OpenElement, 'directive' | 'id'> {
	return props;
}
