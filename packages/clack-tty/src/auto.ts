/**
 * Activator entry: `@ghostwright/clack-tty/auto`.
 *
 * Declared in an application's package.json, husky-style:
 *
 *   "@clack/ui": { "extensions": ["@ghostwright/clack-tty/auto"] }
 *
 * or handed to `createUI({ extensions: [semanticAuto] })` explicitly, or
 * registered out-of-band by a launcher preload:
 *
 *   import { registerUIExtension } from '@clack/ui/extensions';
 *   import semanticAuto from '@ghostwright/clack-tty/auto';
 *   registerUIExtension(semanticAuto);
 *
 * The extension installs the semantic producer only when the launcher sets
 * `CLACK_UI_SEMANTIC=1`, so production runs of the same application load this
 * package but never emit a frame. Exactly one activation channel should be
 * used per application — mixing them double-installs the observer.
 */
import type { UIExtension } from '@clack/ui/extensions';
import { useSemantic } from './producer.ts';

const semanticAuto: UIExtension = (context) => {
	if (process.env.CLACK_UI_SEMANTIC !== '1') return;
	useSemantic(context.host, {
		// Read createUI's live surface at frame time. This honors both terminal
		// resizes and explicit width/height options.
		surface: () => ({ columns: context.width, rows: context.height }),
	});
};

export default semanticAuto;
