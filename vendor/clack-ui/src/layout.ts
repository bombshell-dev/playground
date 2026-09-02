import { createApi } from './core.ts';
import { type Op } from '@bomb.sh/tty';

export const LayoutApi = createApi('layout', {
	layout(_): Iterable<Op> {
		return [];
	},
});

export const { layout } = LayoutApi.methods;
