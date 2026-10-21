import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { GhostwrightError } from '../src/errors.ts';
import type { TestContext } from 'vitest';
import { recordingExtension, type RecordingExtension } from './recording.ts';

/* oxlint-disable bombshell-dev/exported-function-async -- A synchronous disposable scopes capture to the test body. */
/** Supply test naming and opt-in configuration; the terminal owns capture and export. */
export function recordTest(context: TestContext): RecordingExtension {
	const mode = process.env.GHOSTWRIGHT_RECORD;

	if (mode && !['cast', 'gif', 'mp4', 'gif,mp4'].includes(mode))
		throw new GhostwrightError({
			code: 'GW_RECORDING_OPTIONS',
			message: 'GHOSTWRIGHT_RECORD must be cast, gif, mp4, or gif,mp4',
		});
	const name = context.task.name.replace(/[^a-z0-9]+/gi, '-').slice(0, 80);
	const id = createHash('sha256').update(context.task.id).digest('hex').slice(0, 8);
	const directory = pathToFileURL(
		`${process.env.GHOSTWRIGHT_RECORD_DIR ?? '.ghostwright/recordings'}/`,
	);
	const path = fileURLToPath(new URL(`${name}-${id}`, directory));
	return recordingExtension({
		output: path,
		enabled: !!mode,
		formats: mode === 'cast' ? [] : mode === 'gif' ? ['gif'] : ['mp4'],
	});
}
