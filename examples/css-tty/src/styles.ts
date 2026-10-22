// The demo stylesheet.
//
// Two mechanisms carry terminal capabilities into values:
//
// - `@media` queries read the environment record built from the terminal's
//   capability maps: `(min-width: 80ch)` keys off the cell-mapped viewport,
//   `(orientation)` off its aspect, `(prefers-reduced-motion)` off the
//   host's switch.
// - `light-dark()` resolves at computed-value time against the color scheme
//   derived from the probed background color. Note the property choice:
//   resolution covers `color` and `*-color` properties, so panels use
//   `background-color` and borders use `border-color` rather than the
//   `background` / `border` shorthands.
//
// The render bridge (src/render.ts) maps the computed declarations to
// terminal cells: `width`/`height` percentages fill the terminal, `flex: 1`
// grows children to share space, `flex-direction` picks the main axis,
// `gap`/`padding` become cell counts, `border` + `border-color` draw
// borders, and `color`/`background-color` paint cells.
export const DEMO_CSS = `
	:root {
		--fg: light-dark(#1b1b22, #e2e2e8);
		--panel: light-dark(#ffffff, #1f1f28);
		--muted: light-dark(#5f5f6b, #9a9aa8);
		/* Amber while narrow; the wide breakpoint hands the accent to violet. */
		--accent: light-dark(#b45309, #f59e0b);
		--axis: column;
		--columns: 1;
		--gap: 1px;
		--motion: steady;
	}

	/* 80 columns (80ch = 640px at 8px cells) or wider: a row board, and the
	   accent changes with it — resize across the breakpoint to see both. */
	@media (min-width: 80ch) {
		:root {
			--axis: row;
			--columns: 2;
			--gap: 2px;
			--accent: light-dark(#6d28d9, #8b5cf6);
		}
	}

	/* Shape of the terminal decides the board's main axis. */
	@media (orientation: portrait) {
		:root {
			--axis: column;
		}
	}

	/* Hosts wire their own motion switch; terminals expose none. */
	@media (prefers-reduced-motion: reduce) {
		:root {
			--motion: none;
		}
	}

	.app {
		width: 100%;
		height: 100%;
		color: var(--fg);
		background-color: var(--panel);
		display: flex;
		flex-direction: column;
		gap: 1px;
		padding: 1px;
	}
	.header {
		border: 1px;
		border-color: var(--accent);
		color: var(--accent);
		gap: 1px;
	}
	.title {
		color: var(--accent);
	}
	.status {
		color: var(--muted);
	}
	.board {
		flex: 1;
		display: flex;
		flex-direction: var(--axis);
		gap: var(--gap);
	}
	.card {
		flex: 1;
		background-color: var(--panel);
		border: 1px;
		border-color: var(--accent);
		color: var(--fg);
		gap: var(--gap);
		padding: 1px;
	}
	.heading {
		color: var(--accent);
	}
	.body {
		color: var(--muted);
	}
	.statusbar {
		border: 1px;
		border-color: var(--muted);
	}
	.numbers {
		color: var(--muted);
	}
`;
