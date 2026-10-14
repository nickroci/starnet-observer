'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const files = fs.readdirSync(path.join(root, 'test')).filter(file => file.endsWith('.test.js')).sort();
for (const file of files) {
  console.log('\n' + file);
  const result = spawnSync(process.execPath, [path.join(root, 'test', file)], { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log('\nAll ' + files.length + ' test files passed.');
