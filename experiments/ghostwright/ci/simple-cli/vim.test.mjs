import { test } from 'node:test';
import { vimNormalSkills } from './journey.mjs';

test('built Ghostwright records netrw and Vim editing', { timeout: 250_000 }, vimNormalSkills);
