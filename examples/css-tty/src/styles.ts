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
export const DEMO_CSS = `
	:root {
		--fg: light-dark(#1b1b22, #e2e2e8);
		--panel: light-dark(#ffffff, #1f1f28);
		--muted: light-dark(#5f5f6b, #9a9aa8);
		--accent: light-dark(#b45309, #f59e0b);
		--columns: 1;
		--axis: column;
		--gap: 1px;
		--motion: steady;
	}

	/* 80 columns (80ch = 640px at 8px cells) or wider: two-column board. */
	@media (min-width: 80ch) {
		:root {
			--columns: 2;
			--gap: 2px;
		}
	}

	/* Shape of the terminal decides the board's main axis. */
	@media (orientation: landscape) {
		:root {
			--axis: row;
		}
	}

	/* Hosts wire their own motion switch; terminals expose none. */
	@media (prefers-reduced-motion: reduce) {
		:root {
			--motion: none;
		}
	}

	.app {
		color: var(--fg);
		background-color: var(--panel);
		display: flex;
		flex-direction: var(--axis);
		gap: var(--gap);
		padding: 1px;
	}
	.header {
		border-color: var(--accent);
		color: var(--accent);
		font-weight: 700;
		gap: var(--gap);
	}
	.status {
		color: var(--muted);
		font-weight: 400;
	}
	.board {
		display: flex;
		flex-direction: var(--axis);
		gap: var(--gap);
		grid-template-columns: repeat(var(--columns), 1fr);
	}
	.card {
		background-color: var(--panel);
		border-color: var(--accent);
		color: var(--fg);
		gap: var(--gap);
		padding: 1px;
	}
	.heading {
		color: var(--accent);
		font-weight: 700;
	}
	.body {
		color: var(--muted);
	}
`;
