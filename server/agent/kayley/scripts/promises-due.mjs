#!/usr/bin/env node
/**
 * promises-due.mjs
 *
 * Lists due promises from Supabase `promises` table.
 * Intended for use by an agentTurn cron: the agent runs this script,
 * sends fulfillment messages/media, then marks promises fulfilled.
 *
 * Output: JSON to stdout
 * {
 *   now: ISO,
 *   due: [{ id, promise_type, description, trigger_event, estimated_timing, commitment_context, fulfillment_data, status }]
 * }
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

// load .env if present
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

const headers = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
};

function isoNow() {
  return new Date().toISOString();
}

async function main() {
  const now = isoNow();

  // due = pending + estimated_timing <= now
  const url = `${SUPABASE_URL}/rest/v1/promises?select=id,promise_type,description,trigger_event,estimated_timing,commitment_context,fulfillment_data,status&status=eq.pending&estimated_timing=lte.${encodeURIComponent(now)}&order=estimated_timing.asc&limit=25`;
  const res = await fetch(url, { headers });
  if (!res.ok) {
    console.error(`❌ Fetch failed: ${await res.text()}`);
    process.exit(1);
  }
  const due = await res.json();

  process.stdout.write(JSON.stringify({ now, due }, null, 2));
}

main().catch((e) => {
  console.error('❌ Fatal', e);
  process.exit(1);
});
