/**
 * Keep package.json and manifest.json versions in step.
 *
 * Nothing previously enforced this, so a release tag could produce a zip whose
 * manifest still carried an older version. They happened to agree only by luck.
 *
 *   node scripts/sync-version.mjs            copy package.json version → manifest
 *   node scripts/sync-version.mjs --check    verify they agree; exit 1 if not
 *   node scripts/sync-version.mjs --check --tag v1.2.0   also verify the tag
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packagePath = resolve(root, 'package.json');
const manifestPath = resolve(root, 'manifest.json');

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

const args = process.argv.slice(2);
const isCheck = args.includes('--check');
const tagIndex = args.indexOf('--tag');
const tag = tagIndex === -1 ? undefined : args[tagIndex + 1];

const packageJson = readJson(packagePath);
const manifest = readJson(manifestPath);
const expected = packageJson.version;

const problems = [];

if (manifest.version !== expected) {
  problems.push(`manifest.json is ${manifest.version}, package.json is ${expected}`);
}

if (tag) {
  const tagVersion = tag.replace(/^v/, '');
  if (tagVersion !== expected) {
    problems.push(`tag ${tag} does not match package.json version ${expected}`);
  }
}

if (isCheck) {
  if (problems.length > 0) {
    console.error('Version mismatch:');
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }
  console.log(`Versions agree: ${expected}`);
  process.exit(0);
}

if (manifest.version === expected) {
  console.log(`manifest.json already at ${expected}`);
  process.exit(0);
}

writeFileSync(manifestPath, `${JSON.stringify({ ...manifest, version: expected }, null, 2)}\n`);
console.log(`manifest.json updated to ${expected}`);
