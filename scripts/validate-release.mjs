import { readFileSync, statSync } from 'node:fs';

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const fail = (message) => {
  console.error(`Release validation failed: ${message}`);
  process.exitCode = 1;
};

const manifest = readJson('manifest.json');
const packageJson = readJson('package.json');
const versions = readJson('versions.json');
const semver = /^\d+\.\d+\.\d+$/;

for (const key of ['id', 'name', 'version', 'minAppVersion', 'description', 'author', 'helpUrl', 'isDesktopOnly']) {
  if (manifest[key] === undefined || manifest[key] === '') fail(`manifest.json is missing ${key}`);
}
if (!/^[a-z-]+$/.test(manifest.id)) fail('plugin id must contain lowercase letters and hyphens only');
if (manifest.id.includes('obsidian') || manifest.id.endsWith('plugin')) fail('plugin id uses a reserved term');
if (!semver.test(manifest.version)) fail('manifest version must use x.y.z');
if (!semver.test(manifest.minAppVersion)) fail('minimum app version must use x.y.z');
if (!/^[\x20-\x7e\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]+$/.test(manifest.name)) {
  fail('plugin name must use Latin or CJK characters only');
}
const endsWithStop = manifest.description.endsWith('.') || manifest.description.endsWith('\u3002');
if (manifest.description.length > 250 || !endsWithStop) {
  fail('description must be at most 250 characters and end with a period');
}
if (!/^https:\/\/github\.com\/[^/]+\/[^/]+(?:[#/?].*)?$/.test(manifest.helpUrl)) {
  fail('helpUrl must link to the plugin GitHub repository over HTTPS');
}
if (manifest.version !== packageJson.version) fail('package and manifest versions differ');
if (versions[manifest.version] !== manifest.minAppVersion) fail('versions.json does not map the current release');

for (const path of [
  'main.js', 'manifest.json', 'styles.css', 'README.md', 'LICENSE',
  'date-core.js', 'topic-core.js', 'status-core.js', 'docs/USER-GUIDE.md',
  'fsrs-core.js', 'card-provider-core.js',
]) {
  try {
    if (!statSync(path).isFile()) fail(`${path} is not a file`);
  } catch {
    fail(`${path} is missing`);
  }
}

const main = readFileSync('main.js', 'utf8');
for (const unsupported of ['window.app', 'this.app.plugins', '.innerHTML', '.outerHTML', 'insertAdjacentHTML']) {
  if (main.includes(unsupported)) fail(`main.js contains unsupported API usage: ${unsupported}`);
}
for (const shellApi of ["require('child_process')", 'require("child_process")', 'node:child_process']) {
  if (main.includes(shellApi)) fail(`main.js must not use shell execution: ${shellApi}`);
}
for (const broadEnumeration of ['getMarkdownFiles()', 'getFiles()']) {
  if (main.includes(broadEnumeration)) fail(`main.js enumerates the entire vault: ${broadEnumeration}`);
}

const releaseWorkflow = readFileSync('.github/workflows/release.yml', 'utf8');
if (!releaseWorkflow.includes('actions/attest@v4') || !releaseWorkflow.includes('attestations: write')) {
  fail('release workflow does not attest release assets');
}

if (!process.exitCode) console.log('Release metadata and assets are valid.');
