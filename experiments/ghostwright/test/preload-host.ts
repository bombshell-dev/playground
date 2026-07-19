// oxlint-disable-next-line no-restricted-imports -- path module needed for path resolution
import { resolve } from 'node:path';
import { usePtyHostForTesting } from '../src/profile.ts';
import { GhostwrightError } from '../src/errors.ts';

const host = process.env.GHOSTWRIGHT_CONTRACT_HOST;
if (!host)
	throw new GhostwrightError({
		code: 'GW_MISSING_ENV',
		message: 'GHOSTWRIGHT_CONTRACT_HOST is required',
	});
usePtyHostForTesting(resolve(host));
