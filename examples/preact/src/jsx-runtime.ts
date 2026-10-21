// Adapted from @clack/ui-preact at 606675f16131c6ae7c4553a67ab477bdf661f772.
// Copyright (c) 2025-Present Bombshell contributors. MIT license; see LICENSE.
import type { JSX as PreactJSX } from 'preact/jsx-runtime';
import type { HostElements } from './index.ts';

export { Fragment, jsx, jsxs } from 'preact/jsx-runtime';

export declare namespace JSX {
	type Element = PreactJSX.Element;
	type ElementType = string | Exclude<PreactJSX.ElementType, string>;
	type ElementClass = PreactJSX.ElementClass;
	type ElementAttributesProperty = PreactJSX.ElementAttributesProperty;
	type ElementChildrenAttribute = PreactJSX.ElementChildrenAttribute;
	type IntrinsicAttributes = PreactJSX.IntrinsicAttributes;
	type LibraryManagedAttributes<Component, Props> = PreactJSX.LibraryManagedAttributes<
		Component,
		Props
	>;
	interface IntrinsicElements extends HostElements {}
}
