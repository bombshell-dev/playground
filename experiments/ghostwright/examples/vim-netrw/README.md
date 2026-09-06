# Finding controls in Vim without OSC

This spike treats Vim's netrw explorer as a control, using only its rendered screen. The adapter is ordinary TypeScript. It does not import Vim state, query buffers or window coordinates, emit OSC descriptions, or use a runtime LLM.

```ts
const explorer = netrw(ui);
const readme = explorer.find('README.md');

await readme.open();
await ui.expect(readme.editor).toContainText('# Opened through the explorer');
```

`netrw.test.ts` is the runnable example. It launches a real Vim with an explorer on the left and an editor on the right. Both windows contain `README.md`. Only the explorer's entry is a valid target.

## Run

From `experiments/ghostwright`, after the normal artifact setup:

```sh
bun test examples/vim-netrw
```

The tests require Vim with its bundled netrw. They do not silently skip a missing installation. Set `GHOSTWRIGHT_VIM` to select another Vim executable. The spike was validated locally with Apple's Vim 9.1 and netrw v184 on macOS arm64, not Neovim or other Vim versions.

The fixture disables user configuration, swap files, viminfo, and netrw history. It explicitly loads the bundled netrw and uses standard display options. Startup commands arrange the windows; opening the target file uses only normal-mode navigation and Enter.

## How it finds a file

1. Trace a reverse-video vertical separator from the top of the screen to the statusline.
2. Confirm the reverse-video statusline and the full-height left-window layout.
3. Find netrw's heading and the rules above and below its banner.
4. Search only the listing below the banner for an exact filename row.

Every step reads the same immutable screen snapshot. Regions exclude the separator, statusline, and neighboring editor. Duplicate entries remain duplicate matches; strict execution rejects them. Ambiguous window boundaries raise an error rather than selecting the first candidate.

`open()` waits for the entry and a visible cursor, then checks that the cursor belongs to the listing. It sends a counted `j` or `k` motion. It resolves the entry again and waits for visible cursor evidence before pressing Enter. It recognizes the resulting editor from the filename painted in the left statusline. Assertions then inspect that editor's actual cells.

## Deliberate limits

This is an authored adapter for one arrangement, not a general Vim DOM:

- One full-height explorer on the left of a vertical split.
- One command row and the default monochrome separator/statusline appearance.
- Netrw's visible banner and thin listing style.
- Visible, unwrapped regular-file entries with simple ASCII names.
- Normal-mode keyboard navigation, starting inside the listing.
- No scrolling search, directory traversal, tree/wide views, themes, or arbitrary window layouts.

Missing geometry or a missing entry stays unmatched and ends in the normal assertion timeout, with the screen diagnostic. The adapter does not guess coordinates. An unsupported filename, an ambiguous boundary, or a cursor in the wrong window fails explicitly. Recognition is a screen heuristic under these constraints, not proof that arbitrary Vim layouts can be reconstructed.

## What this validates

The only new core primitive is:

```ts
const locator = defineScreenLocator('description', (screen) => {
	// Pure spatial reasoning over this snapshot. Return zero or more rectangles.
	return regions;
});
```

It uses the same region inspection, strict matching, assertions, and scope-owned execution as OSC-backed locators. The Vim-specific interpretation and control actions stay in `netrw.ts`; they are not built into Ghostwright.

The live tests cover two viewport sizes, both navigation directions, the neighboring filename decoy, and refusal to navigate from the wrong window. Focused recognition tests use grids decoded by real Ghostty to check banner scoping, duplicate matches, missing boundaries, and ambiguity.
