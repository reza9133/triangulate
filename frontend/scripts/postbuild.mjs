// Single-page-app hosting helpers: GitHub Pages serves 404.html for unknown paths, so a copy of
// index.html there makes deep links such as /claims/CLM-0001 work after a refresh.
import { copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
copyFileSync(join(dist, 'index.html'), join(dist, '404.html'));
console.log('dist/404.html written');
