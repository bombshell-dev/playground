import { loadCssComponent, decodeIr, NO_PARENT } from './abi.js';

const source = document.querySelector('#source');
const output = document.querySelector('#output');
const status = document.querySelector('#status');
const widthInput = document.querySelector('#viewport-width');

const component = await loadCssComponent(await (await fetch('./bombshell_css_wasm.wasm')).blob());
let sheet_handle = null;

// The demo tree: a panel container with two cards, one focused.
const nodes = [
  { tag: 'root', classes: ['root', 'panel'], width: 400, height: null, state: 0 },
  { tag: 'card', classes: ['card'], state: 0 },
  { tag: 'card', classes: ['card', 'special'], state: 1 }, // focused
  { tag: 'title', classes: ['title'] },
  { tag: 'title', classes: ['title'] },
];
const parents = [NO_PARENT, 0, 0, 1, 2];
const tags = ['root', 'card', 'card.special (focus)', 'title', 'title'];

function format(condition) {
  if (!condition || condition.type === 'unknown') return 'unknown';
  switch (condition.type) {
    case 'feature': return `${condition.feature.name}`;
    case 'not': return `not ${format(condition.inner)}`;
    case 'and': return condition.conditions.map(format).join(' and ');
    case 'or': return condition.conditions.map(format).join(' or ');
    case 'size': return `${condition.feature.name}`;
    case 'style': return condition.text;
    case 'declaration': return `${condition.name}: ${condition.value}`;
    case 'selector': return condition.text;
    default: return condition.type;
  }
}

function run() {
  try {
    const { ir, diagnostics } = component.compile(source.value, 2);
    const lines = [];
    for (const diagnostic of diagnostics) {
      lines.push(`${diagnostic.severity === 0 ? 'error' : 'warning'} [${diagnostic.code}] ${diagnostic.message}`);
    }

    if (ir) {
      const sheet = decodeIr(ir);
      if (sheet_handle !== null) component.release(sheet_handle);
      sheet_handle = component.prepare(ir);
      if (sheet_handle === null) throw new Error('prepare rejected the IR');
      lines.push(`IR v${sheet.version} — ${ir.byteLength} bytes, ${sheet.rules.length} rules`);
      lines.push('');
      const env = {
        viewportWidth: Number(widthInput.value) || null,
        viewportHeight: 300,
        colorScheme: 'dark',
        reducedMotion: false,
        resolution: 1,
      };
      const computedPerNode = component.computeTree(sheet_handle, nodes, parents, env);
      nodes.forEach((node, index) => {
        lines.push(`${tags[index]}:`);
        for (const [name, value] of computedPerNode[index]) {
          lines.push(`  ${name}: ${value}`);
        }
        lines.push('');
      });
      lines.push('compiled rules:');
      for (const rule of sheet.rules) {
        const conditions = [
          ...rule.media.map((m) => `@media ${format(m)}`),
          ...rule.containers.map((c) => `@container ${c.name ? c.name + ' ' : ''}${format(c.condition)}`),
          ...rule.supports.map((s) => `@supports ${format(s)}`),
        ];
        const prefix = conditions.length ? `${conditions.join(' AND ')} » ` : '';
        const layer = rule.layer ? `@layer ${rule.layer.join('.')} » ` : '';
        lines.push(`  ${prefix}${layer}${rule.selector}`);
      }
    }
    output.textContent = lines.join('\n');
    status.value = ir ? 'ok' : 'compile failed';
  } catch (error) {
    status.value = 'error';
    output.textContent = error instanceof Error ? error.stack : String(error);
  }
}

source.addEventListener('input', run);
widthInput.addEventListener('input', run);
run();
