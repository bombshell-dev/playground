# Playground PR recording prototype

`.github/workflows/ghostwright-recording.yml` builds the Ghostwright source at the
PR's checked-out merge commit, including native artifacts and the recording
plugin. It packs that build and invokes the local `record-simple-cli` action.
There are no sibling UI/TTY checkouts and no published Ghostwright dependency.

The action copies `simple-cli` into a fresh directory under RUNNER_TEMP, installs
its locked runtime dependency and the generated tarball, and runs Node's test
runner. The test imports `ghostwright` and `ghostwright/recording` through the
installed package exports and asserts those imports resolve into package `dist/`.
It launches a real shell CLI, types Ada, checks the greeting and process exit,
and records the session with the packaged plugin.

MP4, intermediate GIF, asciicast, JSON frames and source metadata are uploaded
with 14-day retention, even after a test/encoder failure. A failed test still
fails the check. Setup failures before capture can produce no recording. The
Actions job summary and PR comment link to the artifact download; GitHub artifact
links are downloads, not inline video attachments.

The separate report job checks out no code, consumes only job result/URL outputs,
and updates one bot comment. Only same-repository PRs receive comments in this
prototype; forks and manual runs retain their Actions summaries/artifacts. The
report job verifies the PR head still matches the event before writing. It uses
pull-requests:write while the build/test job only has contents:read. This is a
same-repository prototype, not the planned trusted-default-branch publisher for
arbitrary fork PRs.

Tool versions and download checksums are pinned in the workflow where practical.
FFmpeg, ncurses and fonts come from Ubuntu 24.04's package repositories. Native
artifacts are rebuilt from the pinned Ghostty source, patch and Rust lockfile;
the build refreshes artifact hashes in the packaged manifest and verifies its ABI.
No native build cache is used in this first prototype.

The consumer lock pins Effection 4.2.0, matching the scope API used by Ghostwright.
This isolated test caught that the former package minimum (4.0.2) and workspace
lock (4.0.3) were incompatible even though the linked development graph worked.

For a local run, build Ghostwright with `pnpm build` in its directory (after
building native artifacts), `npm pack` into a temporary directory, copy
`ci/simple-cli/*` into an empty consumer directory, run `npm ci`, then
`npm install --no-save --package-lock=false /absolute/path/ghostwright-0.1.0.tgz`.
Set `GHOSTWRIGHT_RECORD_DIR` to a writable directory and run `node --test test.mjs`
from that consumer. agg and FFmpeg must be on PATH. Use Node 24.22.0 as in CI.
