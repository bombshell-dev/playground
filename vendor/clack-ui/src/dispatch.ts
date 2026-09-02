import { createApi } from './core.ts';
import type { Host } from './host.ts';

export const DispatchApi = createApi('dispatch', {
	dispatch(_node, _event: unknown): Result {
		return Ok;
	},
});

export function useDispatch(host: Host): void {
	DispatchApi.around(host.root, {
		dispatch(args, next) {
			try {
				return next(...args);
			} catch (reason) {
				return { ok: false, reason };
			}
		},
	});
}

export type Result =
	| typeof Ok
	| {
			ok: false;
			reason: unknown;
	  };

const Ok = { ok: true } as const;
