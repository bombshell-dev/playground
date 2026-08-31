import type { WriteStream } from 'node:tty';
import type { Op, RenderResult, Term } from '@bomb.sh/tty';
import { createApi } from './core.ts';

export const RenderApi = createApi('render', {
	requestRender(_): void {},
	render(_node, output: WriteStream, term: Term, ops: Op[]): RenderResult {
		const result = term.render(ops);
		output.write(result.output);
		return result;
	},
});

export const { requestRender } = RenderApi.methods;
