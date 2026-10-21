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
Actions job summary and PR comment link to the artifact download. The bot also
uploads the MP4 to GitHub attachment storage and places the returned URL in its
own paragraph, which GitHub renders as a native inline video player. Attachments
are separate from Actions artifacts and do not share their 14-day retention.
No release or tag is created for new recordings.

GitHub documents this behavior in
[Attaching files with GitHub CLI](https://docs.github.com/en/github-cli/github-cli/attaching-files-with-github-cli).
The publisher calls the same token-authenticated media endpoint used by
`gh pr comment --attach`: `POST https://uploads.github.com/user-attachments/assets`,
with repository ID, filename and media type as query parameters and raw MP4 bytes
as the body. This avoids depending on the runner's installed CLI version. The
[gh-attach implementation](https://github.com/sudosubin/gh-attach/blob/e1d63f6c5fbe70a46fcf085035e39e8f422c2b4e/internal/github/attachments/token_uploader.go)
also demonstrates this endpoint. No browser cookies are needed. GitHub's upload endpoint does **not** accept the
Actions `GITHUB_TOKEN` (an installation token): the live CI attempt returned 404.
The [GitHub CLI token allowlist](https://github.com/cli/cli/blob/trunk/internal/attachments/client.go)
accepts OAuth, classic/fine-grained PATs and some user-to-server tokens instead.

Configure a repository Actions secret named `GHOSTWRIGHT_ATTACHMENT_TOKEN` with
a user token whose owner has write access to playground. Prefer a fine-grained
PAT restricted to this repository, with Contents: read/write and Pull requests:
read (the upload step also verifies the current PR head). This secret is used
only by the upload step in the same-repository report job, never the test job.
The comment step retains `GITHUB_TOKEN`, so comments remain authored by the bot.
Without the secret, the report fails with an explicit setup message while keeping
the test recording available as an artifact.

The separate report job checks out no code, downloads the current run's recording
artifact as data, publishes only the fixed MP4 filename (limited to 10 MiB for
compatibility with GitHub's free-plan limit), and updates one bot comment. It never
executes downloaded files. Missing MP4s retain diagnostics; publishing failures
still update the comment and then fail the report job. Only same-repository PRs
receive comments in this prototype; forks and manual runs retain their Actions
summaries/artifacts. The report job verifies the PR head still matches the event
before writing. Its default token uses pull-requests:write, actions:read and contents:read,
while the build/test job only has contents:read. This is a same-repository prototype, not the planned
trusted-default-branch publisher for arbitrary fork PRs.

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
