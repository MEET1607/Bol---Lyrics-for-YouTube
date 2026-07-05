import { mkdirSync, copyFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

function copyRecursive(src, dest) {
  if (!existsSync(src)) return;
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src)) {
    const srcPath = join(src, entry);
    const destPath = join(dest, entry);
    if (statSync(srcPath).isDirectory()) {
      copyRecursive(srcPath, destPath);
    } else {
      copyFileSync(srcPath, destPath);
    }
  }
}

mkdirSync('dist', { recursive: true });
copyFileSync('public/manifest.json', 'dist/manifest.json');
copyRecursive('public/icons', 'dist/icons');
