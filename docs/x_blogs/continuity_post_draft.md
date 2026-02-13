Title
We Rebuilt Memory Retrieval, Not Just Memory Storage

Most AI memory systems fail for one simple reason:
they store a lot, but retrieve poorly.

That was our issue. We had facts, notes, and storylines, but replies could still miss known context when wording changed or topics shifted fast.

So this phase was not "add more memory."
It was "make memory retrieval reliable."

What we built

- Per-turn active recall
- Semantic retrieval (embedding + vector search)
- Lexical retrieval (word/key overlap)
- Hybrid ranking (semantic + lexical + practical boosts)
- Safety gates with fail-open behavior

On the data side, we added/used dedicated storage layers for each memory role:

- `fact_embeddings`
- `conversation_anchor`
- context synthesis rows
- `topic_exhaustion`

Why "synthesis rows" are listed a little differently:
- `fact_embeddings`, `conversation_anchor`, and `topic_exhaustion` are operational memory layers (index/state tracking).
- Context synthesis is a derived compression layer: it summarizes broader memory into a compact, reusable block.
- It still lives in rows in the database, but functionally it behaves more like a generated memory artifact than a raw memory table.

Why this matters

Before: we pushed large memory blocks into prompts and hoped the model picked the right line.

Now: each user message gets targeted retrieval first, then broader context.

Result:
- better relevance
- better robustness under partial failure
- better latency discipline

What "hybrid retrieval" actually means

Quick glossary:
- Embedding: numeric fingerprint of meaning
- Vector search: "find memories closest in meaning"
- Lexical match: direct word overlap
- Fail-open: if retrieval fails, chat still replies

1) Semantic path (meaning match)

How it works:
- Convert current message into an embedding
- Query nearest memory vectors

Made-up example:
- User: "Did your mom's call go okay?"
- Stored memory: "Follow up after mother's appointment"
- Different wording, same meaning -> semantic can still match

2) Lexical path (word/key match)

How it works:
- Tokenize user text
- Score overlap against memory keys/values/storyline text

Made-up example:
- User: "How is Linger going?"
- Memory key: `song_linger_progress`
- Direct "linger" overlap -> strong lexical signal

3) Hybrid ranking (best candidates first)

How it works:
- Combine semantic + lexical relevance
- Add deterministic boosts:
  - key hit
  - recency
  - confidence
  - pinned importance
- Keep only top items for prompt injection

Made-up example:
- Two Dallas memories match
- One is recent + pinned + key-aligned
- Hybrid ranking promotes that one

4) Safety gates (reliability)

How it works:
- Semantic empty/slow -> fallback to lexical
- If both weak -> inject nothing and continue
- Never block response generation

Made-up example:
- Semantic timeout happens
- Lexical still finds "Dallas" and "Linger"
- Response continues with useful context

Current thresholds in production (what "weak" means right now)

To keep this concrete, here is how "weak" is currently defined in our runtime logic:

- Semantic minimum similarity for selection: `0.55`
- Lexical minimum signal for selection: `4`
- Strong lexical signal (required before boost-heavy scoring): `6`
- Strong key signal (required before boost-heavy scoring): `8`
- Final minimum score to include a memory item: `18`
- Semantic timeout budget: `350ms`
- Lexical timeout budget: `180ms`

What this means in plain English:

- If semantic similarity is below `0.55`, we treat it as too weak to trust.
- If lexical overlap is tiny (below `4`) and no key match exists, we treat it as too weak.
- Even "somewhat relevant" items must still clear total score `18` to be injected.
- If retrieval paths are slow, we stop waiting and continue with fallback/empty behavior.

Made-up weak-signal example:

- User message: "yeah that one"
- Semantic finds low-confidence matches (<0.55)
- Lexical overlap is minimal (<4)
- Nothing clears final score threshold
- Result: no recall section injected, but response still proceeds normally

Strong score vs low score examples (made-up)

Below are simple examples of what creates high-scoring recall vs low-scoring recall.

1) Strong lexical example

- User: "How is Linger practice going?"
- Memory key: `song_linger_progress`
- Memory value: "Practicing the main riff every night"

Why this scores high:
- clear word overlap (`linger`, `practice`)
- direct key match
- recent fact
- decent confidence, maybe pinned

Example breakdown:
- lexical: `24`
- key bonus: `15`
- recency: `15`
- confidence: `8`
- pinned: `5`
- total: `67` (very strong)

2) Low lexical example

- User: "How was lunch?"
- Memory key: `sony_dallas_venue_shortlist`
- Memory value: "Need to confirm venue lighting for Dallas"

Why this scores low:
- almost no word overlap
- no key match
- boost-heavy scoring does not kick in for weak relevance

Example breakdown:
- lexical: `1`
- key bonus: `0`
- recency: `0`
- confidence: `0`
- pinned: `0`
- total: `1` (filtered out)

3) Strong semantic example

- User: "Did your mom's call go okay?"
- Memory value: "Follow up after mother's doctor appointment"

Why this scores high:
- wording is different, but meaning is close
- semantic similarity is high (example `0.82`)

Example breakdown:
- semantic: `57.4` (`0.82 x 70`)
- lexical: `6`
- key bonus: `0`
- recency: `15`
- confidence: `8`
- pinned: `0`
- total: `86.4` (very strong)

4) Low semantic example

- User: "yeah that one"
- Candidate memories are vague/unrelated

Why this scores low:
- semantic similarities come in below selection floor (`< 0.55`)
- lexical overlap is also weak

Outcome:
- semantic path produces no eligible winner
- lexical fallback also weak
- no recall block injected, response still proceeds

5) Borderline example (barely included)

- User: "Dallas plans?"
- Memory key: `dallas_trip`
- Memory value: older planning note

Why this is borderline:
- some overlap + partial key relevance
- but older item and modest confidence

Example breakdown:
- lexical: `8`
- key bonus: `8`
- recency: `0`
- confidence: `3`
- pinned: `0`
- total: `19` (barely above `18` threshold)

How the tables are used (insert, update, read)

`conversation_anchor` (thread working memory)
- Insert: first anchor for an interaction
- Update: every few turns, topic shifts, or time guard
- Read: non-greeting prompt build, early in context order
- Purpose: keep short-term continuity inside the active thread

`fact_embeddings` (semantic index)
- Insert: backfill existing facts + new facts
- Update: re-embed when source facts/storylines change
- Read: semantic/hybrid retrieval per non-greeting turn
- Purpose: paraphrase-aware recall at runtime

Context synthesis rows (daily compressed memory)
- Insert: when synthesis job generates daily row
- Update/Invalidate: expire stale rows, regenerate on change windows
- Read: non-greeting prompt when synthesis is fresh
- Purpose: compress long-horizon context without prompt bloat

`topic_exhaustion` (anti-repetition)
- Insert: first tracked mention for a topic
- Update: increment counts, track initiator, set/clear cooldowns
- Read: prompt suppression section ("don't re-initiate cooled-down topics")
- Purpose: reduce repetitive AI-initiated loops while allowing user-led return

Stale and expired states (and what happens next)

This is one of the most important parts of the system.
Real memory systems are never "always fresh."
The win is not avoiding stale states.
The win is handling stale states safely and predictably.

1) `conversation_anchor` can become stale

What "stale" means:
- The anchor is too old for the current thread pace (for example after a long pause).

What the system does:
- It does not blindly trust old anchor text.
- If anchor is stale, the anchor section is skipped on read.
- Chat continues using other context layers.
- Anchor gets refreshed again in background when update triggers fire (new turns, topic shift, time guard).

Made-up example:
- At 9:00 AM you talk about your meeting stress.
- At 3:30 PM you come back and ask about Dallas travel.
- Old anchor may still emphasize "morning meeting stress."
- Instead of injecting stale emotional state, the system skips stale anchor and relies on current turn + active recall.
- After a couple turns, a fresh anchor is generated from the new exchange.

Why this matters:
- Prevents the model from sounding "stuck in the old conversation."

2) Context synthesis rows can be stale or missing

What "stale/missing" means:
- Daily synthesis may be expired, invalidated by new memory changes, or not yet generated for current state.

What the system does:
- If synthesis is stale or missing, it does not force a bad synthesis block.
- Prompt builder falls back to broader raw/contextual sections.
- Response generation still proceeds (no hard stop).
- Synthesis job can regenerate later.

Made-up example:
- A new important fact is stored midday.
- Existing synthesis row still reflects the old morning state.
- On next turn, stale check fails -> synthesis section is omitted.
- Fallback sections carry the turn.
- Later, synthesis regenerates and becomes eligible again.

Why this matters:
- Better to use no synthesis than wrong synthesis.

3) `topic_exhaustion` cooldowns expire over time

What "expired" means:
- A topic was previously cooled down (to avoid repetition), but cooldown window has passed.

What the system does:
- Expired cooldowns are cleared.
- Old mention counts decay over time.
- Topic becomes eligible again for natural future conversation.

Made-up example:
- Kayley and user mention "Sony Dallas venue" repeatedly this week.
- System sets cooldown so Kayley does not keep re-initiating it every few turns.
- Three days pass with no repeated pressure.
- Cooldown expires.
- Topic can be reintroduced naturally later if relevant again.

Why this matters:
- Prevents spammy repetition without permanently muting meaningful topics.

4) Semantic retrieval can be empty or timeout

What "empty/timeout" means:
- Semantic search returns no good candidates, or takes too long.

What the system does:
- Immediately falls back to lexical retrieval.
- If lexical is also weak, injects no recall section.
- Reply still goes out (fail-open behavior).

Made-up example:
- User writes a short message: "yeah, that one."
- Semantic signal is weak.
- Lexical overlap is also weak.
- System injects nothing rather than injecting random memory.
- Kayley still responds naturally using current turn context.

Why this matters:
- Avoids "hallucinated recall" and keeps chat responsive.

5) Stale handling is a feature, not an error

A lot of people assume stale = failure.
In this architecture, stale detection is part of quality control.

The hierarchy is:
- Fresh, high-signal memory -> inject
- Stale/low-signal memory -> skip
- If uncertain -> continue without forced memory

Made-up end-to-end scenario:
- Morning: anchor created around work stress.
- Afternoon: conversation pivots to travel planning.
- Semantic returns sparse results first turn (new phrasing).
- Lexical finds "Dallas" and "tour" facts.
- Stale anchor is skipped to avoid conflict.
- Topic cooldown prevents Kayley from re-looping an old topic.
- New anchor is refreshed after a couple turns to match current flow.

That is exactly the behavior we want:
continuity without rigidity, and safety without silence.

One turn flow (made-up)

- User: "Can we switch gears and plan Dallas for Sony tour stuff?"
- Read path:
  - read `conversation_anchor`
  - semantic query via `fact_embeddings`
  - lexical scoring over facts/storylines
  - hybrid rank + inject top recall items
- Write path (background):
  - refresh `conversation_anchor`
  - upsert new/changed embeddings if memory changed
  - synthesis refresh runs on its own cadence

That split is intentional:
- reads in request path for better replies now
- writes in background for responsiveness

Creativity and emotional nuance

This did not remove creativity.
It made creativity more grounded.

- Creativity remains model-driven (tone, phrasing, story texture)
- Retrieval reduces contradiction/drift

Current tradeoff:
- `almost_moments` / unsaid-feelings cues now run in both synthesis and fallback paths
- next tuning target is consistency and timing so those cues feel natural, not forced

So the state is:
- factual continuity improved a lot
- emotional-subtext continuity is the next tuning target

Proof it improved behavior

From runtime validation/live sessions:
- Active recall now appears in non-greeting turns
- Semantic zero-candidate cases no longer break replies
- Lexical fallback recovers useful context when semantic is sparse
- Relevance improved after stricter filters/scoring gates
- Prompt dilution reduced via bounded fallback sections

In short: recall moved from "best effort" to engineered behavior.

If this interests you, follow along:
https://github.com/stozo04/Interactive-Video-Character

