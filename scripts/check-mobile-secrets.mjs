#!/usr/bin/env node
// Fails if anything that looks like a server secret, or a web target, is present in the
// mobile app's source, config or (when it exists) exported bundle.
// Run: node scripts/check-mobile-secrets.mjs
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const mobile = join(root, 'apps/mobile');

const FORBIDDEN = [
  [/SUPABASE_SERVICE_ROLE_KEY/, 'service-role key variable'],
  [
    /SEARCH_PROVIDER_API_KEY|LLM_PROVIDER_API_KEY|GEOCODER_API_KEY|RESEARCH_WORKER_SECRET/,
    'server-side provider secret variable',
  ],
  [/sb_secret_[A-Za-z0-9]{8,}/, 'Supabase secret key literal'],
  [
    /eyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,}\./,
    'JWT literal (keys belong in .env, never in source)',
  ],
  [/sk-ant-[A-Za-z0-9_-]{10,}|BSA[A-Za-z0-9_-]{20,}/, 'provider API key literal'],
];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (['node_modules', '.expo', 'android', 'ios', 'assets'].includes(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

const problems = [];
for (const file of walk(mobile)) {
  if (/\.env\.example$|\.test\.ts$/.test(file)) continue;
  const isBundle = file.includes(`${join('apps', 'mobile', 'dist')}`);
  if (!isBundle && !/\.(ts|tsx|js|json|mjs)$/.test(file)) continue;
  const text = readFileSync(file, isBundle ? 'latin1' : 'utf8');
  for (const [pattern, label] of FORBIDDEN) {
    if (pattern.test(text)) problems.push(`${relative(root, file)}: ${label}`);
  }
}

const config = readFileSync(join(mobile, 'app.config.ts'), 'utf8');
if (/^\s*web\s*:/m.test(config))
  problems.push(
    'apps/mobile/app.config.ts: a web target is configured (native only in this release)',
  );
if (!/platforms:\s*\['ios',\s*'android'\]/.test(config))
  problems.push("apps/mobile/app.config.ts: platforms must be ['ios', 'android']");
if (
  /isAndroidBackgroundLocationEnabled:\s*true|isIosBackgroundLocationEnabled:\s*true/.test(config)
)
  problems.push('apps/mobile/app.config.ts: background location must stay off');
const pkg = JSON.parse(readFileSync(join(mobile, 'package.json'), 'utf8'));
for (const dep of ['react-dom', 'react-native-web', 'next']) {
  if (pkg.dependencies?.[dep] || pkg.devDependencies?.[dep])
    problems.push(`apps/mobile/package.json: "${dep}" is a web dependency`);
}
if (existsSync(join(mobile, '.env'))) {
  const env = readFileSync(join(mobile, '.env'), 'utf8');
  for (const line of env.split('\n')) {
    const name = line.split('=')[0]?.trim();
    if (
      name &&
      !name.startsWith('#') &&
      !name.startsWith('EXPO_PUBLIC_') &&
      name !== 'EAS_PROJECT_ID'
    ) {
      problems.push(
        `apps/mobile/.env: "${name}" is not an EXPO_PUBLIC_ value and does not belong in the app`,
      );
    }
  }
}

if (problems.length) {
  console.error(
    'Mobile secret / platform check FAILED:\n' + problems.map((p) => `  - ${p}`).join('\n'),
  );
  process.exit(1);
}
console.log(
  'Mobile secret / platform check passed: no server secrets, no web target, no background location.',
);
