/** Base error class for all Ghostwright errors. */
export class GhostwrightError extends Error {
	readonly code: string;
	sessionName?: string;
	tracePath?: string;
	suppressed?: unknown[];
	constructor(params: { code: string; message: string } & ErrorOptions & { sessionName?: string }) {
		super(params.message, params);
		this.name = new.target.name;
		this.code = params.code;
		this.sessionName = params.sessionName;
	}
}
function errorType<T extends string>(name: T, code: string) {
	return class extends GhostwrightError {
		constructor(message: string, options?: ErrorOptions & { sessionName?: string }) {
			super({ code, message, ...options });
			this.name = name;
		}
	};
}
/** Error for unsupported platform detection. */
export class UnsupportedPlatformError extends errorType(
	'UnsupportedPlatformError',
	'GW_UNSUPPORTED_PLATFORM',
) {}
/** Error for asset integrity check failures. */
export class AssetIntegrityError extends errorType('AssetIntegrityError', 'GW_ASSET_INTEGRITY') {}
/** Error for Deno permission denials. */
export class DenoPermissionError extends errorType('DenoPermissionError', 'GW_DENO_PERMISSION') {}
/** Error for reserved environment variable conflicts. */
export class ReservedEnvironmentError extends errorType(
	'ReservedEnvironmentError',
	'GW_RESERVED_ENV',
) {}
/** Error for host launch failures. */
export class LaunchError extends errorType('LaunchError', 'GW_LAUNCH') {}
/** Error for protocol violations. */
export class ProtocolError extends errorType('ProtocolError', 'GW_PROTOCOL') {}
/** Error when host command exceeds timeout. */
export class HostCommandTimeoutError extends errorType(
	'HostCommandTimeoutError',
	'GW_HOST_TIMEOUT',
) {}
/** Error when sidecar process exits unexpectedly. */
export class SidecarExitedError extends errorType('SidecarExitedError', 'GW_SIDECAR_EXITED') {}
/** Error when process exits unexpectedly. */
export class ProcessExitedError extends errorType('ProcessExitedError', 'GW_PROCESS_EXITED') {}
/** Error when session is already closed. */
export class SessionClosedError extends errorType('SessionClosedError', 'GW_SESSION_CLOSED') {}
/** Error for coordinate out-of-range. */
export class CoordinateRangeError extends errorType(
	'CoordinateRangeError',
	'GW_COORDINATE_RANGE',
) {}
/** Error for strict locator match failures. */
export class StrictLocatorError extends errorType('StrictLocatorError', 'GW_LOCATOR_STRICT') {}
/** Error for terminal assertion failures. */
export class TerminalAssertionError extends errorType('TerminalAssertionError', 'GW_ASSERTION') {}
/** Error when terminal history has been evicted. */
export class HistoryEvictedError extends errorType('HistoryEvictedError', 'GW_HISTORY_EVICTED') {}
/** Error when terminal history changes unexpectedly. */
export class HistoryChangedError extends errorType('HistoryChangedError', 'GW_HISTORY_CHANGED') {}
/** Error writing trace files. */
export class TraceWriteError extends errorType('TraceWriteError', 'GW_TRACE_WRITE') {}
/** Error during cleanup operations. */
export class CleanupError extends errorType('CleanupError', 'GW_CLEANUP') {}
