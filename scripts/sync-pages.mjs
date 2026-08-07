import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distRoot = resolve(projectRoot, 'dist');
const generatedAssets = resolve(projectRoot, 'site-assets');
const distAssets = resolve(distRoot, 'site-assets');

if (!generatedAssets.startsWith(`${projectRoot}${sep}`) || !distAssets.startsWith(`${distRoot}${sep}`)) {
    throw new Error('Refusing to synchronize Pages files outside the project.');
}

const compiledIndex = await readFile(resolve(distRoot, 'index.html'), 'utf8');
if (compiledIndex.includes('main.tsx') || compiledIndex.includes('/src/')) {
    throw new Error('The Pages entry still references source files instead of the production bundle.');
}

await rm(generatedAssets, { recursive: true, force: true });
await mkdir(generatedAssets, { recursive: true });
await cp(distAssets, generatedAssets, { recursive: true });
await writeFile(resolve(projectRoot, 'index.html'), compiledIndex, 'utf8');
await writeFile(resolve(projectRoot, '.nojekyll'), '', 'utf8');

console.log('Synchronized compiled GitHub Pages files to the repository root.');
