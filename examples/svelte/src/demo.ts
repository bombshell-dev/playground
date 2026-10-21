import { Document } from '@bomb.sh/dom';
import { FixtureRealm } from '@examples/dom-realm';
import { compileFixture } from './compile.ts';

const document = new Document();
document.appendChild(document.createElement('application'));
const realm = new FixtureRealm(document);
realm.run(await compileFixture());
await realm.run('fixture.mount()');
await realm.run('fixture.update("updated")');
process.stdout.write(`${document.documentElement?.textContent}\n`);
await realm.run('fixture.unmount()');
