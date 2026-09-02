import type { Component, ComponentType, FunctionComponent, VNode } from 'preact';
import type { JSX as PreactJSX } from 'preact/jsx-runtime';
import type { HostElements } from './index.ts';

export { Fragment, jsx, jsxs } from 'preact/jsx-runtime';

export declare namespace JSX {
	type LibraryManagedAttributes<ManagedComponent, Props> = PreactJSX.LibraryManagedAttributes<
		ManagedComponent,
		Props
	>;
	interface IntrinsicAttributes extends PreactJSX.IntrinsicAttributes {}
	type ElementType = keyof HostElements | ComponentType<never>;
	interface Element extends VNode<unknown> {}
	type ElementClass = Component<unknown, unknown> | FunctionComponent<unknown>;
	interface ElementAttributesProperty {
		props: unknown;
	}
	interface ElementChildrenAttribute {
		children: unknown;
	}
	type IntrinsicElements = HostElements;
}
