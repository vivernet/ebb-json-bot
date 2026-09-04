/** @file Проверяет синтаксис всех исходников, тестов и служебных скриптов без их запуска. */

import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
let checked = 0;

for (const directory of ['src', 'test', 'scripts']) {
  const base = join(root, directory);
  for (const entry of readdirSync(base, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.js')) continue;

    const path = join(entry.parentPath, entry.name);
    const result = spawnSync(process.execPath, ['--check', path], { stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exitCode = 1;
    checked++;
  }
}

if (!process.exitCode) console.log(`Синтаксис проверен: ${checked} файлов.`);
