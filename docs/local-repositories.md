# Develop against the UI and TTY repositories

The development workspace composes existing independent checkouts. It does not
copy source into `vendor/`, switch branches, or rewrite repository manifests.
Edit, commit, and switch branches in the owning repositories as usual.

The default layout is the shared Bombshell context workspace:

```text
bombshell/
  context.json
  repos/                         # ignored by the context workspace
    playground/
      .dev/workspace/            # generated, ignored by playground
    ui/
    tty/
      build/npm/                 # generated npm package
```

`ui/packages/ui` and `ui/packages/ui-preact` provide the actual UI packages.
`tty/build/npm` provides the npm-compatible TTY package. The TTY repository root
is a Deno project and is not itself the package Node applications should import.

## Prepare and install

From playground, run:

```sh
pnpm dev:repos prepare
```

To use other existing checkouts, including branches checked out elsewhere:

```sh
pnpm dev:repos prepare --ui /path/to/ui --tty /path/to/tty
```

Missing repositories can be assembled through the context workspace's
`clone-repo` skill and `context clone` CLI. In this workspace they already exist;
reuse them unless you deliberately need another independent copy. For example,
`context clone bombshell-dev/ui --name ui-pizza --workspace /path/to/bombshell`
creates a separate checkout for the UI integration branch without changing the
existing UI checkout.

Select the desired branches in those checkouts before preparing. For the new
document API plus Preact, `dom-preact` is the starting UI branch; use a new
integration branch from it for extension work. TTY can start from current main.
The helper records the actual branches, commits, paths, and presence of local
changes in `.dev/workspace/sources.json`. This is a local snapshot, not a lock
that resets or checks out a commit.

Build TTY using its `BUILD.md`: initialize the Clay submodule and run `make`
with Clang, LLD, and Deno installed. Then run its npm build, passing the version
from its package.json, for example:

```sh
deno task build:npm 0.9.0
```

Back in playground, install the composed graph:

```sh
pnpm dev:repos install
```

The install command accepts the same `--ui` and `--tty` flags and remembers
the selected paths from the last preparation when omitted. It checks that
the Preact package and generated TTY package exist before installing. Lifecycle
scripts are disabled; build packages explicitly. The workspace's lockfile and
virtual store live under `.dev/workspace`.

Build the linked UI packages through the composed workspace:

```sh
pnpm dev:build-ui
pnpm test:linked-ui
```

Package exports currently point at build output, so rebuild UI after edits.
For TTY TypeScript changes, rerun its npm build; for C/WASM changes, run `make`
first as well. These steps are not watched automatically.

The linked tests cover direct document text updates and the Preact pizza
journey with semantic locators. Run all pizza checks from playground:

```sh
pnpm test:pizza
pnpm typecheck:pizza
```

`test:pizza` runs the existing six real-PTY journeys, the five imperative
in-process tests, and three linked DOM/Preact tests. The native Ghostwright host,
Ghostty WASM, and terminfo must be built for PTY tests. On a fresh checkout run
Ghostwright's `setup` script with Bun, Zig 0.15.2, Rust/Cargo (including the local
musl target on Linux), and `tic` available. Its artifact builder normalizes
Linux/macOS terminfo directory names before verification.

Additional adapter checks run with:

```sh
pnpm --dir .dev/workspace --filter @ghostwright/clack-tty --filter @ghostwright/hello-world test
```

The original vendored copies remain for legacy examples, but are excluded from
the composed development graph. The migrated pizza and semantic adapter no
longer import their APIs or use TypeScript aliases to reach them.

The helper replaces catalog entries and overrides for `@clack/ui`,
`@clack/ui-preact`, and `@bomb.sh/tty` with `workspace:*`. This ensures UI and
the application use the same TTY provider, despite their older version ranges.
The two identically named vendored UI packages are excluded from this workspace.
UI's tooling patches are included with absolute paths to the owning checkout.
Shared build tooling is installed at the composed root as well, so pnpm can
find `bsh` when executing scripts in the external package directories.

Installing a composed workspace updates `node_modules` links in the participating
checkouts. To return to the original playground graph, run `pnpm install --force`
from playground; reinstall UI's own workspace too if returning it to standalone
development. Source manifests and the original lockfiles are not rewritten by
the composition helper. Reprepare/reinstall after changing branch metadata.

`pnpm test:dev-repos` exercises the composition against temporary Git repositories
and an offline pnpm install. It verifies shared UI/TTY resolution, exclusion of a
duplicate vendored UI provider, and preservation of source manifests.

## The semantic terminal extension

The extension hooks are implemented in the real UI checkout on
`spike/pizza-extensions`, based on `dom-preact` with adapted `dom-style` work.
TTY remains on current main; it needed no public API changes.

- `createUI({ extensions })` installs UI-local extensions before the first render.
- Context exposes the document, injected streams, and live width/height.
- `context.onRender(observer)` observes each committed render and returns an
  unsubscribe function. `context.write(bytes)` awaits writes on the same stream.
- Frames carry immutable element IDs, parent/order, attribute snapshots, and
  authoritative TTY geometry captured synchronously with rendering. Mutations
  while a write is backpressured cannot change an earlier frame's description.
- Observers finish before the next frame writes. Returned extension cleanup runs
  at UI disposal before terminal settings are restored. Observer errors propagate
  through `main()` and disposal.
- Package-declared extensions use the same API as explicit options. An optional
  `extensionRoot` selects their application directory; it defaults to cwd.
  Choose one activation channel for the semantic producer.

`@ghostwright/clack-tty` remains an independent adapter in playground. Its
producer consumes committed frame data and appends the existing versioned OSC
payload. Its consumer still decodes that message and pairs it with the preceding
Ghostty screen. Descriptions identify elements and geometry; terminal cells,
styles, and cursor remain the assertion evidence. CSS locators and the protocol
are unchanged.

The package-declared `/auto` extension activates with `CLACK_UI_SEMANTIC=1` for
subprocess tests. In-process tests install `useSemantic` as an explicit UI-local
extension, so they do not change process environment variables or import test
instrumentation into application code.

The UI integration also adds keyboard editing, cancelable key events, submission,
modal focus scopes/restoration, and resize handling through current TTY's
`term.update(events)` API. Styles use the DOM declaration API instead of old Host
property bags. Borders reserve their own space in current TTY, so the style
mapping does not add the old border-padding compensation.

The application modules are `packages/pizza/src/app.ts` (document construction)
and `packages/pizza-preact/src/app.tsx` (Preact). They are reused by their CLI
entry points and by the injected-stream tests. UI owns rendering/input lifetime;
Ghostwright continues to own either the real PTY connection or the in-process
terminal connection.
