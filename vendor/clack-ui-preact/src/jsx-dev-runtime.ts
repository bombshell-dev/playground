import type { Component, ComponentType, FunctionComponent, VNode } from 'preact';
import type { JSX as PreactJSX } from 'preact/jsx-dev-runtime';
import type { HostElements } from './index.ts';

export { Fragment, jsxDEV } from 'preact/jsx-dev-runtime';

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
	interface IntrinsicElements extends HostElements {}
}
