/**
 * Activator entry: `@ghostwright/clack-tty/auto`.
 *
 * Declared in an application's package.json, husky-style:
 *
 *   "@clack/ui": { "extensions": ["@ghostwright/clack-tty/auto"] }
 *
 * Or pass this extension explicitly to createUI({ extensions: [semanticAuto] }).
 * Activation is gated by CLACK_UI_SEMANTIC=1. For an in-process test, install
 * useSemantic as an explicit UI-local extension instead of changing process.env.
 * The returned cleanup removes the observer at UI disposal.
 */
import type { UIExtension } from '@clack/ui/extensions';
import { useSemantic } from './producer.ts';

const semanticAuto: UIExtension = (context) => {
	if (process.env.CLACK_UI_SEMANTIC !== '1') return;
	return useSemantic(context);
};

// oxlint-disable-next-line import/no-default-export -- clack/ui package extension loader expects a default export
export default semanticAuto;
