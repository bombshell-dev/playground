# Playground PR recording prototype

`.github/workflows/ghostwright-recording.yml` builds the Ghostwright source at the
PR's checked-out merge commit, including native artifacts and the recording
plugin. It packs that build and invokes the local `record-simple-cli` action.
There are no sibling UI/TTY checkouts and no published Ghostwright dependency.

The action copies `simple-cli` into a fresh directory under RUNNER_TEMP, installs
the shared Vim journey (`examples/vim-netrw/journey.mjs` and `netrw.ts`),
its locked runtime dependency and the generated tarball, and runs Node's test
runner. The test imports `ghostwright` and `ghostwright/recording` through the
installed package exports and asserts those imports resolve into package `dist/`.
It launches a real shell CLI, types Ada, checks the greeting and process exit,
and records the session with the packaged plugin. A second Node test runs the
same Vim journey as `pnpm record:vim`: open netrw, locate `refactor.ts` from
painted screen geometry, edit with text objects, repeat, uppercase, yank/put,
increment, undo/redo, then save and exit. Both examples import the built package.
Run a package build before using the local Vim example after source changes.

MP4, intermediate GIF, asciicast, JSON frames and source metadata are uploaded
with 14-day retention, even after a test/encoder failure. A failed test still
fails the check. Setup failures before capture can produce no recording. The
Actions job summary and PR comment link to the artifact download. The bot also
links directly to both MP4s, published as `video/mp4` assets on a dedicated
`ghostwright-recordings-pr-<number>` prerelease. Each run/attempt gets a unique
filename. Release media remains until the release is deleted; the 14-day limit
applies only to Actions artifacts. The prerelease never becomes the latest release.

A direct release asset URL avoids downloading/unzipping the whole artifact.
GitHub's native inline comment player requires a GitHub video attachment;
release asset links are not native comment attachments. The supported release
API works with the workflow token and requires no browser session credentials.
Native inline attachments are deferred: the user-token attempt was rejected by
GitHub. The current workflow does not reference `GHOSTWRIGHT_ATTACHMENT_TOKEN`.

The separate report job checks out no code, downloads the current run's recording artifact as data,
publishes only `simple-cli.mp4` and `vim-normal-skills.mp4` (each limited to 25 MiB), and updates one bot
comment. It never executes downloaded files. Missing MP4s retain diagnostics;
publishing failures still update the comment and then fail the report job. Only same-repository PRs receive comments in this
prototype; forks and manual runs retain their Actions summaries/artifacts. The
report job verifies the PR head still matches the event before writing. It uses
pull-requests:write, actions:read and contents:write (for release uploads), while the build/test job only has contents:read. This is a
same-repository prototype, not the planned trusted-default-branch publisher for
arbitrary fork PRs.

Tool versions and download checksums are pinned in the workflow where practical.
Vim, FFmpeg, ncurses and fonts come from Ubuntu 24.04's package repositories. Native
artifacts are rebuilt from the pinned Ghostty source, patch and Rust lockfile;
the build refreshes artifact hashes in the packaged manifest and verifies its ABI.
No native build cache is used in this first prototype.

The consumer lock pins Effection 4.2.0, matching the scope API used by Ghostwright.
This isolated test caught that the former package minimum (4.0.2) and workspace
lock (4.0.3) were incompatible even though the linked development graph worked.

For a local run, build Ghostwright with `pnpm build` in its directory (after
building native artifacts), `npm pack` into a temporary directory, copy
`ci/simple-cli/*` and `examples/vim-netrw/{journey.mjs,netrw.ts}` into an empty
consumer directory, run `npm ci`, then
`npm install --no-save --package-lock=false /absolute/path/ghostwright-0.1.0.tgz`.
Set `GHOSTWRIGHT_RECORD_DIR` to a writable directory and run `node --test test.mjs vim.test.mjs`
from that consumer. Vim (with netrw), agg and FFmpeg must be on PATH. Use Node 24.22.0 as in CI.
