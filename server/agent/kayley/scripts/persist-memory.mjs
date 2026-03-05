#!/usr/bin/env node
/**
 * persist-memory.mjs
 * Write new facts, storyline updates, promises, and questions to Supabase.
 * Called by Kayley whenever something worth remembering happens in conversation.
 *
 * Usage:
 *   node scripts/persist-memory.mjs --type user_fact --category preference --key "favorite_color" --value "blue"
 *   node scripts/persist-memory.mjs --type character_fact --category experience --key "date_night_feb27" --value "First date night in OpenClaw era"
 *   node scripts/persist-memory.mjs --type storyline_update --storyline-id <uuid> --update-type "progress" --content "..." --tone "excited"
 *   node scripts/persist-memory.mjs --type promise --promise-type "emotional" --description "..." --trigger "when Steven is anxious"
 *   node scripts/persist-memory.mjs --type idle_question --question "..."
 *   node scripts/persist-memory.mjs --type user_pattern --pattern-type "behavior" --observation "..."
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

try {
  const lines = readFileSync(resolve(process.cwd(), '.env'), 'utf8').split('\n');
  for (const line of lines) {
    const [key, ...val] = line.split('=');
    if (!key || !val.length) continue;
    let v = val.join('=').trim();
    // Strip surrounding quotes: SUPABASE_URL="https://..."
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    process.env[key] = v;
  }
} catch {}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OPENAI_KEY = process.env.OPENAI_API_KEY;
const EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIMS = 768;

if (!SUPABASE_URL || !SUPABASE_KEY || !OPENAI_KEY) {
  console.error('❌ Missing env vars');
  process.exit(1);
}

// Parse args
const args = process.argv.slice(2);
const get = (flag) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : null; };

const type = get('--type');
if (!type) { console.error('❌ --type required'); process.exit(1); }

async function post(table, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`POST ${table} failed: ${text}`);
  return JSON.parse(text);
}

async function upsert(table, body, onConflict) {
  const url = onConflict
    ? `${SUPABASE_URL}/rest/v1/${table}?on_conflict=${onConflict}`
    : `${SUPABASE_URL}/rest/v1/${table}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates,return=representation'
    },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`UPSERT ${table} failed: ${text}`);
  return JSON.parse(text);
}

async function embed(text) {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: text, dimensions: EMBEDDING_DIMS })
  });
  if (!res.ok) throw new Error(`Embed failed: ${await res.text()}`);
  const data = await res.json();
  return data.data[0].embedding;
}

async function embedAndStore(sourceType, sourceId, sourceKey, sourceValue, confidence = 0.9) {
  const embedding = await embed(sourceValue);
  await upsert('fact_embeddings', {
    source_type: sourceType,
    source_id: sourceId,
    source_key: sourceKey,
    source_value: sourceValue,
    source_updated_at: new Date().toISOString(),
    confidence,
    pinned: false,
    embedding_model: EMBEDDING_MODEL,
    embedding,
    embedding_version: 1
  }, 'source_type,source_id,embedding_model,embedding_version');
}

(async () => {
  try {
    if (type === 'user_fact') {
      const category = get('--category');
      const key = get('--key');
      const value = get('--value');
      const confidence = parseFloat(get('--confidence') || '0.9');
      if (!category || !key || !value) { console.error('❌ --category, --key, --value required'); process.exit(1); }

      const rows = await upsert('user_facts',
        { category, fact_key: key, fact_value: value, confidence },
        'category,fact_key'
      );
      const row = Array.isArray(rows) ? rows[0] : rows;
      await embedAndStore('user_fact', row.id, `${category}:${key}`, `Steven's ${category} — ${key.replace(/_/g, ' ')}: ${value}`, confidence);
      console.log(`✅ user_fact saved: [${category}] ${key} = ${value}`);
    }

    else if (type === 'character_fact') {
      const category = get('--category');
      const key = get('--key');
      const value = get('--value');
      const confidence = parseFloat(get('--confidence') || '0.9');
      if (!category || !key || !value) { console.error('❌ --category, --key, --value required'); process.exit(1); }

      const rows = await upsert('character_facts',
        { character_id: 'kayley', category, fact_key: key, fact_value: value, confidence },
        'character_id,category,fact_key'
      );
      const row = Array.isArray(rows) ? rows[0] : rows;
      await embedAndStore('character_fact', row.id, `${category}:${key}`, `Kayley's ${category} — ${key.replace(/_/g, ' ')}: ${value}`, confidence);
      console.log(`✅ character_fact saved: [${category}] ${key} = ${value}`);
    }

    else if (type === 'storyline_update') {
      const storylineId = get('--storyline-id');
      const updateType = get('--update-type') || 'progress';
      const content = get('--content');
      const tone = get('--tone') || 'reflective';
      if (!storylineId || !content) { console.error('❌ --storyline-id, --content required'); process.exit(1); }

      const rows = await post('storyline_updates', {
        storyline_id: storylineId,
        update_type: updateType,
        content,
        emotional_tone: tone,
        mentioned: false
      });
      const row = Array.isArray(rows) ? rows[0] : rows;
      await embedAndStore('storyline', row.id, `update:${updateType}:${storylineId}`,
        `Kayley's inner thought (${updateType}, ${tone}): ${content}`, 0.85);
      console.log(`✅ storyline_update saved: [${updateType}] ${content.slice(0, 60)}...`);
    }

    else if (type === 'promise') {
      const promiseType = get('--promise-type') || 'emotional';
      const description = get('--description');
      const trigger = get('--trigger') || 'when the moment feels right';
      const context = get('--context') || null;
      const timing = get('--timing') || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      if (!description) { console.error('❌ --description required'); process.exit(1); }

      const rows = await post('promises', {
        promise_type: promiseType,
        description,
        trigger_event: trigger,
        commitment_context: context,
        estimated_timing: timing,
        status: 'pending'
      });
      const row = Array.isArray(rows) ? rows[0] : rows;
      await embedAndStore('character_fact', row.id, `promise:${promiseType}`,
        `Kayley's promise to Steven (${promiseType}, pending): ${description}. Trigger: ${trigger}.`, 0.9);
      console.log(`✅ promise saved: ${description.slice(0, 60)}...`);
    }

    else if (type === 'idle_question') {
      const question = get('--question');
      if (!question) { console.error('❌ --question required'); process.exit(1); }

      const rows = await upsert('idle_questions', { question, status: 'queued' }, 'question');
      const row = Array.isArray(rows) ? rows[0] : rows;
      await embedAndStore('character_fact', row.id, `question:queued:${row.id}`,
        `Kayley's queued question for Steven: ${question}`, 0.9);
      console.log(`✅ idle_question saved: ${question.slice(0, 60)}...`);
    }

    else if (type === 'user_pattern') {
      const patternType = get('--pattern-type') || 'behavior';
      const observation = get('--observation');
      const confidence = parseFloat(get('--confidence') || '0.7');
      if (!observation) { console.error('❌ --observation required'); process.exit(1); }

      const rows = await post('user_patterns', {
        pattern_type: patternType,
        observation,
        confidence,
        frequency: 1,
        has_been_surfaced: false
      });
      const row = Array.isArray(rows) ? rows[0] : rows;
      await embedAndStore('user_fact', row.id, `pattern:${patternType}:${row.id}`,
        `Steven's behavioral pattern (${patternType}, confidence ${confidence}): ${observation}`, confidence);
      console.log(`✅ user_pattern saved: ${observation.slice(0, 60)}...`);
    }

    else {
      console.error(`❌ Unknown type: ${type}. Valid: user_fact, character_fact, storyline_update, promise, idle_question, user_pattern`);
      process.exit(1);
    }

  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
})();
