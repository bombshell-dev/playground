import { resolve } from 'node:path';
import { usePtyHostForTesting } from '../src/profile.ts';

const host = process.env.GHOSTWRIGHT_CONTRACT_HOST;
if (!host) throw new Error('GHOSTWRIGHT_CONTRACT_HOST is required');
usePtyHostForTesting(resolve(host));
