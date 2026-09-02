import type { HostElements as CoreHostElements } from '@clack/ui';
import type { ComponentChildren, Key, Ref } from 'preact';
import type { ElementHandle } from './facade.ts';

type PreactProperties<Properties> = {
	[Name in keyof Properties as Name extends string
		? Name extends `on${infer Type}`
			? `on${Capitalize<Type>}`
			: Name
		: Name]: Properties[Name];
} & {
	children?: ComponentChildren;
	key?: Key | null;
	ref?: Ref<ElementHandle>;
};

export type HostElements = {
	[Name in keyof CoreHostElements]: PreactProperties<CoreHostElements[Name]>;
};

export type BoxProps = HostElements['box'];
export type InputProps = HostElements['input'];
export type TextProps = HostElements['text'];
