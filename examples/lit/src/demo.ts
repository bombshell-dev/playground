import { Document, Element } from '@bomb.sh/dom';
import { bundleFixture, FixtureRealm } from '@examples/dom-realm';

const document = new Document();
document.appendChild(document.createElement('application'));
const realm = new FixtureRealm(document);
realm.run(await bundleFixture(new URL('./component.js', import.meta.url)));
await realm.run('fixture.mount()');
await realm.run('fixture.setCount(4)');
const counter = document.documentElement?.firstChild;
if (counter instanceof Element)
	process.stdout.write(`${counter.shadowRoot?.textContent?.trim()}\n`);
