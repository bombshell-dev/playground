import { text as ttyText, type Op, type Text as TextOp } from '@bomb.sh/tty';
import { type Primitive, stringifyPrimitive } from '../children.ts';

/** Text props — a 1:1 passthrough to the tty `text` op for now (friendlier shapes later). */
export type TextProps = Omit<TextOp, 'directive' | 'content'>;

export function text(props: TextProps, ...content: Primitive[]): Op {
	// `join` coerces the `undefined` drops (null/undefined/booleans) to '', leaving `0`/`''` intact.
	const str = content.map(stringifyPrimitive).join('');
	return ttyText(str, textPropsToOps(props));
}

function textPropsToOps(props: TextProps): Omit<TextOp, 'directive' | 'content'> {
	return props;
}
