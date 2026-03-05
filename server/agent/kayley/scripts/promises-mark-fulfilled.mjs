#!/usr/bin/env node
/**
 * promises-mark-fulfilled.mjs
 *
 * Marks a promise fulfilled (or missed/cancelled) in Supabase.
 *
 * Usage:
 *   node scripts/promises-mark-fulfilled.mjs <promiseId> [--status fulfilled] [--note "..."]
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

try {
  const lines = readFileSync(resolve(process.cwd(), '.env'), 'utf8').split('\n');
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const [k, ...v] = t.split('=');
    if (k && v.length) process.env[k] = v.join('=').trim();
  }
} catch {}

const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim().replace(/^['"]|['"]$/g, '');
const SUPABASE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim().replace(/^['"]|['"]$/g, '');

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ Missing env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const id = process.argv[2];
if (!id) {
  console.error('Usage: node scripts/promises-mark-fulfilled.mjs <promiseId> [--status fulfilled|missed|cancelled] [--note "..."]');
  process.exit(1);
}

const args = process.argv.slice(3);
const statusIdx = args.indexOf('--status');
const status = statusIdx !== -1 ? args[statusIdx + 1] : 'fulfilled';
const noteIdx = args.indexOf('--note');
const note = noteIdx !== -1 ? args[noteIdx + 1] : null;

const headers = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
  Prefer: 'return=minimal',
};

const patch = {
  status,
  fulfilled_at: status === 'fulfilled' ? new Date().toISOString() : null,
};

if (note) {
  patch.fulfillment_data = { note };
}

const url = `${SUPABASE_URL}/rest/v1/promises?id=eq.${encodeURIComponent(id)}`;
const res = await fetch(url, {
  method: 'PATCH',
  headers,
  body: JSON.stringify(patch),
});

if (!res.ok) {
  console.error(`❌ Patch failed: ${await res.text()}`);
  process.exit(1);
}

console.log(`✅ Promise ${id} marked ${status}`);
