import { open, close, createTerm, grow, text } from "@bomb.sh/tty";
import { stdout } from 'node:process';

async function run () {
    const term = await createTerm({ width: stdout.columns, height: stdout.rows });
    const result = term.render([
        open('root', { layout: { width: grow(), height: grow(), alignX: 'center', alignY: 'center' }}),
        text('Hello world!'),
        close()
    ])
    stdout.write(result.output);
}

run();
