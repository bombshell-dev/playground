import { expect, test } from 'vitest';
import { expectTerminal, withTerminalAsync } from 'ghostwright';
import {
  clackTtyExtension,
  expectFocused,
  expectTreeCondition,
  type ClackTtySession,
} from '@ghostwright/clack-tty';

// The Preact application is a process-level black box. This test drives the
// real terminal and observes only its visible screen and semantic tree.
const extension = clackTtyExtension();

const entry = () => ({
  command: process.execPath,
  args: ['--import', 'tsx', 'src/index.tsx'],
  cwd: new URL('..', import.meta.url).pathname,
  viewport: { columns: 80, rows: 24 },
  env: { CLACK_UI_SEMANTIC: '1' },
  trace: 'off' as const,
  extensions: [extension],
});

type Terminal = Parameters<Parameters<typeof withTerminalAsync>[1]>[0];

function semantic(terminal: Terminal) {
  return terminal.extension(extension) as ClackTtySession;
}

async function tabTo(terminal: Terminal, session: ClackTtySession, expectedLabel: string) {
  const previousLabel = session.locator('[focused]').matches()[0]?.attrs.label;
  for (let attempt = 0; attempt < 3; attempt++) {
    await terminal.keyboard.press('Tab');
    try {
      await expectTreeCondition(
        terminal,
        () => session.locator('[focused]').matches()[0]?.attrs.label !== previousLabel,
        `focus leaves ${previousLabel}`,
        1200,
      );
    } catch {
      if (attempt < 2) continue;
      throw new Error(`focus did not leave ${previousLabel}`);
    }

    const actualLabel = session.locator('[focused]').matches()[0]?.attrs.label;
    expect(actualLabel).toBe(expectedLabel);
    return;
  }
}

test('Preact pizza completes both forms and restores the delivery tab order', async () => {
  await withTerminalAsync(entry(), async (terminal) => {
    const session = semantic(terminal);
    await expectTerminal(terminal.getByText('Pizza Delivery')).toBeStable();

    const name = session.locator('input[label="name"]');
    const address = session.locator('input[label="address"]');
    const addCard = session.locator('button[label="add-card"]');
    const cardNumber = session.locator('input[label="card-number"]');
    const expiry = session.locator('input[label="expiry"]');
    const cvc = session.locator('input[label="cvc"]');
    const submitCard = session.locator('button[label="submit-card"]');
    const dialog = session.locator('dialog[role="dialog"][label="card"]');

    await expectFocused(terminal, name);
    await terminal.keyboard.type('Ryan');
    await expectTerminal(name.getByText('Ryan')).toBePresent();
    await tabTo(terminal, session, 'address');
    await terminal.keyboard.type('1 Main St');
    await expectTerminal(address.getByText('1 Main St')).toBePresent();
    await tabTo(terminal, session, 'add-card');
    await expectFocused(terminal, addCard);
    await terminal.keyboard.press('Enter');

    await expectTreeCondition(terminal, () => dialog.matches().length === 1, 'dialog opens');
    await expectFocused(terminal, cardNumber);
    await tabTo(terminal, session, 'expiry');
    await expectFocused(terminal, expiry);
    await tabTo(terminal, session, 'cvc');
    await expectFocused(terminal, cvc);
    await tabTo(terminal, session, 'submit-card');
    await expectFocused(terminal, submitCard);
    await terminal.keyboard.press('Enter');

    await expectTreeCondition(terminal, () => dialog.matches().length === 0, 'dialog closes');
    await expectFocused(terminal, addCard);
    await expectTerminal(name.getByText('Ryan')).toBePresent();
    await expectTerminal(address.getByText('1 Main St')).toBePresent();
    await tabTo(terminal, session, 'name');
    await expectFocused(terminal, name);
  });
});

test('focused inputs show a native cursor that follows the caret', async () => {
  await withTerminalAsync(entry(), async (terminal) => {
    const session = semantic(terminal);
    await expectTerminal(terminal.getByText('Pizza Delivery')).toBeStable();

    const name = session.locator('input[label="name"]');
    const address = session.locator('input[label="address"]');
    const addCard = session.locator('button[label="add-card"]');
    const cursorIsInside = (selector: string) => {
      const cursor = terminal.screen.snapshot().cursor;
      const rect = session.locator(selector).matches()[0]?.geo?.term;
      return (
        cursor.visible &&
        rect !== undefined &&
        cursor.column > rect.column &&
        cursor.column < rect.column + rect.width - 1 &&
        cursor.row > rect.row &&
        cursor.row < rect.row + rect.height - 1
      );
    };

    await expectFocused(terminal, name);
    const initial = await expectTerminal(terminal).toSatisfy(
      () => cursorIsInside('input[label="name"]'),
      { settleMs: 100 },
    );

    await terminal.keyboard.type('cat');
    const typed = await expectTerminal(terminal).toSatisfy(
      () => terminal.screen.snapshot().cursor.column === initial.cursor.column + 3,
      { settleMs: 100 },
    );

    await terminal.keyboard.press('ArrowLeft');
    await expectTerminal(terminal).toSatisfy(
      () => terminal.screen.snapshot().cursor.column === typed.cursor.column - 1,
      { settleMs: 100 },
    );

    await terminal.keyboard.press('Tab');
    await expectFocused(terminal, address);
    await expectTerminal(terminal).toSatisfy(
      () => cursorIsInside('input[label="address"]'),
      { settleMs: 100 },
    );

    await terminal.keyboard.press('Tab');
    await expectFocused(terminal, addCard);
    await expectTerminal(terminal).toSatisfy(
      () => !terminal.screen.snapshot().cursor.visible,
      { settleMs: 100 },
    );
  });
});
