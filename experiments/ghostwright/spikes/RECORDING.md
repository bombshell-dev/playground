# Local component recordings

This spike reruns ordinary Vitest component tests against Ghostwright's local
`appIO` connection and exports their terminal output as a GIF and MP4. It lives
on `spike/component-recordings` in playground; UI and TTY need no further changes.

## Run

Use the composed development workspace described in
[`docs/local-repositories.md`](../../../docs/local-repositories.md). Install
[agg](https://docs.asciinema.org/manual/agg/installation/) and FFmpeg on PATH.
Tested here with agg 1.9.0 and FFmpeg 7.1.5. `GHOSTWRIGHT_AGG` and
`GHOSTWRIGHT_FFMPEG` can select explicit executable paths. A monospace system
font is required (this machine uses DejaVu Sans Mono).

From playground:

```sh
# Rerun just the two-component test, producing GIF and MP4.
pnpm record:components -t 'records 2 isolated'

# Rerun the existing pizza interaction test with recording enabled.
pnpm record:components -t 'fills the Preact pizza'

# Run component tests normally; no capture or encoders involved.
pnpm test:linked-ui

# Capture only JSON and asciicast, without external tools.
GHOSTWRIGHT_RECORD=cast pnpm test:linked-ui -t 'records 1 isolated'
```

Recordings appear under `packages/pizza-preact/.ghostwright/recordings/` (ignored).
`GHOSTWRIGHT_RECORD_DIR` overrides that directory, relative to the test process's
cwd or as an absolute path. Filenames combine the test name and a test-ID hash,
so independent tests do not overwrite each other. A rerun replaces that test's
previous recording; retries and repeats also reuse its filename.

The helper accepts `GHOSTWRIGHT_RECORD=cast`, `gif`, `mp4`, or `gif,mp4`.
MP4 currently uses GIF as its intermediate, so MP4 mode saves both.

## Add recording to a component test

```tsx
import { recordTest } from './path/to/spikes/recording-vitest.ts';

test('increments a counter', async (context) => {
	const recording = recordTest(context);
	await using terminal = await createTerminal({
		extensions: [clackTtyExtension(), recording],
	});
	await using ui = await createUI({
		...terminal.appIO,
		extensions: [useSemantic],
	});
	using root = createRoot(ui.document.documentElement);
	using _capture = recording;

	root.render(<Counter />);
	terminal.run(ui.main);

	// Existing keyboard, locator and terminal-evidence assertions go here.
});
```

`recordTest(context)` creates a recording extension configured with the test name
and environment flag. Install it in `extensions` alongside the semantic adapter.
Declare `using _capture = recording` **after UI and the Preact root**, before
rendering starts. That scope stops capture before root/UI disposal clears the
screen, including when an assertion throws. Terminal disposal awaits export. The example Vitest config allows 250 seconds
when recording is enabled to cover the encoder timeouts.
Without the environment flag, the recording extension is disabled.

The runner-independent API uses the same extension:

```ts
const recording = recordingExtension({
	output: '/tmp/counter',
	formats: ['gif', 'mp4'],
});
await using terminal = await createTerminal({
	extensions: [clackTtyExtension(), recording],
});
await using ui = await createUI({ ...terminal.appIO, extensions: [useSemantic] });
using _capture = recording;
// Mount components, drive input, assert terminal state.
// Capture stops at scope exit; terminal disposal awaits encoding.
```

It also accepts inline `recordingExtension(...)` registration. In that case
capture lasts until session close, including any application teardown output.
Use the explicit scope when the final useful component frame should be retained.
`recording.stop()` ends capture without exporting; `await recording.export()`
stops and exports immediately. Export is idempotent, including failures. Each
terminal needs a fresh extension instance. Set `stepMs: 0` in its options for
original event timing.

The core extension contract now supports optional OSC decoding and optional
`setup(context)`. Setup receives `current()`, `onFrame(listener)` and
`onAction(listener)`, and may return async cleanup. Both local and PTY sessions
install extensions before app output and await cleanup on close. Failed setup
rolls back already-installed extensions; failed cleanup still runs the rest.
Existing OSC-only extensions retain their decoding behavior.

The same recording extension works with `launchTerminal({ command, extensions })`.
Local actions carry key/type/paste/resize descriptions. PTY actions currently
carry dispatched input byte counts and base64 (omitted for redacted input), plus
resize descriptions. These are dispatch observations, not delivery receipts.
PTY mouse input is included as encoded bytes. Both modes record Ghostty frames;
no application instrumentation is required for recording alone.

## Data and rendering

- `.json`: original relative timestamps in milliseconds, keyboard/paste/resize
  actions, and Ghostty screen snapshots (cells, styles, cursor, viewport).
- `.cast`: asciicast v2 reconstructed from those snapshots. Every changed screen
  becomes an ANSI repaint. Action markers retain their description. The canvas
  covers the largest captured viewport, keeping resize recordings a fixed size.
- `.gif`: agg rasterizes the cast using its terminal renderer and gifski encoder.
- `.mp4`: FFmpeg converts the GIF to H.264/yuv420p at 30 fps, preserves its frame
  delays, and pads dimensions to even numbers for browser playback.

Presentation timing spaces actions at least 450 ms apart and holds the final GIF
frame for 1.5 seconds. This does not insert sleeps into the test. The JSON retains
original timings; the cast contains presentation timings. Intermediate output
snapshots are captured, though agg's 30 fps cap can coalesce very fast frames.
A single `keyboard.type('Ryan')` is one recorded action, not simulated human typing.

The renderer receives serialized Ghostty cells, not the application DOM or its
semantic OSC metadata. Locators still use the semantic extension, while test
assertions and recording frames use the same terminal engine. The serializer
preserves cell placement, wide/combining text, colors, common text styles, and
cursor shape/visibility. Fonts, default palette and rasterization come from agg;
this is not a pixel screenshot of the Ghostty desktop application. Blink is
frozen, hyperlinks are plain text, and Kitty images are not rendered.

## Scope and follow-up

Capture is local to each terminal and bounded to 2,000 events. The JSON stores
full snapshots, so it is intended for short component journeys. Large recordings
need streaming storage and byte limits. Trace actions contain the text typed;
this spike has no full-recording redaction API (PTY input-byte redaction does not
hide text subsequently rendered on screen). The local connection captures
keyboard/paste/resize; local mouse input is not implemented.

Encoder processes have timeouts and use argument arrays, with no shell. JSON
and cast files are written before encoding, and remain available if an encoder
is missing or fails. Encoder failures reject terminal disposal (or an explicit export call).

The local tests cover screen serialization round trips, capture isolation,
stop-on-failure, original vs presentation timing, and retained artifacts after
encoder failure. A separate Ghostwright PTY test verifies automatic recording export
after real input/output; local component tests do not need native PTY artifacts.
The component examples exercise one counter, two independent
counters, and the existing pizza modal journey.

[asciinema/agg](https://github.com/asciinema/agg) was chosen because it already
supports asciicast v2, fonts, color, timing and GIF encoding. It is invoked as an
external tool; no renderer code is copied into Ghostwright. For a production
feature, integrate retained recording data with the existing capture/trace API and
runner attachments, then consider a direct frame-to-video renderer to avoid GIF palette
quantization in the MP4.
