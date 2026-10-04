import { cp, readFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=path.resolve(root,'../squad-bots/packages/core');
const installed=path.join(root,'node_modules/@squad-bots/core');
try { await access(path.join(source,'dist/index.js')); }
catch { throw new Error('Build the sibling Squad Bots project first: cd ../squad-bots && npm install && npm run build'); }
const pkg=JSON.parse(await readFile(path.join(source,'package.json'),'utf8'));
await cp(path.join(source,'dist'),path.join(installed,'dist'),{recursive:true});
await cp(path.join(source,'package.json'),path.join(installed,'package.json'));
console.log(`Synced Squad Bots core ${pkg.version} from the sibling product.`);
