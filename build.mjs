import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('./', import.meta.url);
const template = await readFile(new URL('src/client.js', root), 'utf8');
const helper = (await readFile(new URL('src/completion-read.js', root), 'utf8'))
  .replace('export function createCompletionReadBridge', 'function createCompletionReadBridge');
const marker = '    // @include completion-read';
if (template.split(marker).length !== 2) throw new Error('Expected exactly one completion-read include marker');
const bundle = template.replace(marker, helper.trimEnd().split('\n').map(line => line ? `    ${line}` : '').join('\n'));
const target = new URL('client.js', root);
await writeFile(target, bundle);
console.log(`Built ${fileURLToPath(target)}`);
