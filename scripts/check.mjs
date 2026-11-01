import { readFile, access, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = fileURLToPath(new URL('../', import.meta.url));
const html = await readFile(path.join(root, 'index.html'), 'utf8');
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i);
if (duplicates.length) throw new Error('Duplicate IDs: ' + duplicates.join(', '));
for (const match of html.matchAll(/\b(?:href|src)="([^"]+)"/g)) {
  const ref = match[1];
  if (ref.startsWith('#') && !ids.includes(ref.slice(1))) throw new Error('Broken fragment: ' + ref);
  if (ref.startsWith('./')) await access(path.resolve(root, ref.split(/[?#]/)[0]));
}
for (const match of html.matchAll(/<meta\s+property="og:image"\s+content="([^"]+)"/g)) {
  const image = new URL(match[1]).pathname.split('/assets/')[1];
  if (image) await access(path.join(root, 'assets', image));
}
async function validateDirectory(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await validateDirectory(file);
    else if (entry.name.endsWith('.js')) {
      const check = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
      if (check.status !== 0) throw new Error(check.stderr);
      const source = await readFile(file, 'utf8');
      for (const match of source.matchAll(/(?:from\s*|import\s*\()\s*['"](\.[^'"]+)['"]/g)) await access(path.resolve(path.dirname(file), match[1]));
    }
  }
}
await validateDirectory(path.join(root, 'assets/vendor/cineview'));
const appCheck = spawnSync(process.execPath, ['--check', path.join(root, 'app.js')], { encoding: 'utf8' });
if (appCheck.status !== 0) throw new Error(appCheck.stderr);
if ((html.match(/<cv-scene\b/g) || []).length !== 4) throw new Error('Expected the four approved scenes.');
console.log('Checked four scenes, HTML IDs, local assets, fragments, JavaScript syntax, and Cineview module imports.');
