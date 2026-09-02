import { type FunctionComponent, createElement } from 'preact';
import type { BoxProps, TextProps } from './elements.ts';

export type { BoxProps, TextProps } from './elements.ts';

/** A layout container backed by the Host's `box` element. */
export const Box: FunctionComponent<BoxProps> = (props) => createElement('box', props);

/** A styled text scope backed by the Host's `text` element. */
export const Text: FunctionComponent<TextProps> = (props) => createElement('text', props);
