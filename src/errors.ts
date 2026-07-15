export class GhostwrightError extends Error {
  readonly code: string;
  sessionName?: string;
  tracePath?: string;
  suppressed?: unknown[];
  constructor(code: string, message: string, options?: ErrorOptions & { sessionName?: string }) {
    super(message, options);
    this.name = new.target.name;
    this.code = code;
    this.sessionName = options?.sessionName;
  }
}
function errorType<T extends string>(name: T, code: string) {
  return class extends GhostwrightError {
    constructor(message: string, options?: ErrorOptions & { sessionName?: string }) {
      super(code, message, options);
      this.name = name;
    }
  };
}
export class UnsupportedPlatformError extends errorType(
  "UnsupportedPlatformError",
  "GW_UNSUPPORTED_PLATFORM",
) {}
export class AssetIntegrityError extends errorType("AssetIntegrityError", "GW_ASSET_INTEGRITY") {}
export class DenoPermissionError extends errorType("DenoPermissionError", "GW_DENO_PERMISSION") {}
export class ReservedEnvironmentError extends errorType(
  "ReservedEnvironmentError",
  "GW_RESERVED_ENV",
) {}
export class LaunchError extends errorType("LaunchError", "GW_LAUNCH") {}
export class ProtocolError extends errorType("ProtocolError", "GW_PROTOCOL") {}
export class HostCommandTimeoutError extends errorType(
  "HostCommandTimeoutError",
  "GW_HOST_TIMEOUT",
) {}
export class SidecarExitedError extends errorType("SidecarExitedError", "GW_SIDECAR_EXITED") {}
export class ProcessExitedError extends errorType("ProcessExitedError", "GW_PROCESS_EXITED") {}
export class SessionClosedError extends errorType("SessionClosedError", "GW_SESSION_CLOSED") {}
export class CoordinateRangeError extends errorType(
  "CoordinateRangeError",
  "GW_COORDINATE_RANGE",
) {}
export class StrictLocatorError extends errorType("StrictLocatorError", "GW_LOCATOR_STRICT") {}
export class TerminalAssertionError extends errorType("TerminalAssertionError", "GW_ASSERTION") {}
export class HistoryEvictedError extends errorType("HistoryEvictedError", "GW_HISTORY_EVICTED") {}
export class HistoryChangedError extends errorType("HistoryChangedError", "GW_HISTORY_CHANGED") {}
export class TraceWriteError extends errorType("TraceWriteError", "GW_TRACE_WRITE") {}
export class CleanupError extends errorType("CleanupError", "GW_CLEANUP") {}
