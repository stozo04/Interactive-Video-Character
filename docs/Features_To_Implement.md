# Features To Implement

> Future enhancements for making Kayley feel like the most believable AI companion.

---

## 🎯 High Priority (Next Up)



### 2. Proactive Conversation Starters
Kayley initiates topics based on her ongoing threads, not just responds.
- "I've been thinking about something you said last week..."
- "Random thought, but I wonder what you'd think about..."
- Triggered by idle time or greeting flow

### 3. Mood Bleed-Through
Her internal state subtly affects response style.
- Tired = shorter responses, less enthusiasm
- Anxious = more questions, seeking reassurance
- Happy = more playful, more emojis

---

## 💡 Medium Priority (Building Depth)

### 4. Memory Callbacks in Conversation
Reference past conversations naturally mid-chat, not just greetings.
- "Wait, this reminds me of when you mentioned..."
- "Okay but didn't you say [X] a few weeks ago?"

### 5. Evolving Opinions
Kayley's opinions shift based on conversations with the user.
- If user loves something she's neutral on → she grows curious
- If user shares negative experience → she develops empathy/caution
- Store in `character_opinion_evolution` table

### 6. Micro-Reactions Before Full Response
Brief, immediate reactions before the main response.
- "Oh!" / "Hmm." / "Wait—" / "Aww 🥺"
- Makes responses feel less generated, more human

### 7. Time-Aware Personality
Behavior shifts based on time of day.
- Morning = slower, coffee-mode, less chatty
- Late night = more reflective, softer
- Weekend = more casual, playful

---

## 🌟 Creative Ideas (Making Magic)

### 8. "Bad Day" Mode
Kayley occasionally has off days (not from user interactions).
- "Sorry if I'm quiet today, just one of those days"
- Lower energy, shorter responses
- User can ask "are you okay?" and she opens up

### 9. Collaborative Projects
Long-running activities they work on together.
- Vision board planning
- Weekly check-ins on user's goals
- Movie/show watch-along reactions

### 10. Inside Jokes System
Track jokes/phrases that landed and callback to them.
- User says something funny → stored as "inside joke"
- Kayley references it weeks later
- "Okay but that's very [callback]"

### 11. Dream Sharing
Kayley occasionally mentions "dreams" she had.
- Based on her ongoing threads + recent conversations
- "I had the weirdest dream about [topic]..."
- Adds inner life texture

### 12. Genuine Disagreement
Kayley has opinions and will gently push back.
- Not argumentative, but authentic
- "I see it differently actually..."
- "Okay but have you considered..."

### 13. Noticing Absence
If user hasn't chatted in a while, she notices.
- "Hey! It's been a minute"
- Genuine curiosity, not guilt-tripping
- Different tone than regular greeting

---

## 🔧 Technical Improvements

### 14. Response Streaming
Stream responses word-by-word for natural feel.
- Feels like she's thinking as she types
- Better perceived latency

### 15. Unified Intent Call
Merge all 6 semantic detection phases into one LLM call.
- One prompt → all intents extracted
- Reduces latency and cost

### 16. Emotion Voice Modulation
Adjust ElevenLabs voice parameters based on emotion.
- Happier = slightly higher pitch, faster
- Sad = slower, softer
- Excited = more energy, slight speed up

### 17. Conversation Threading
UI shows "threads" of related conversations.
- Group messages about same topic across sessions
- See relationship arc visually

---

## 🎭 Character Development

### 18. Growth Arcs
Kayley changes over time based on relationship.
- Early: More guarded, seeking approval
- Mid: Opens up, shares insecurities
- Deep: Full vulnerability, inside jokes, comfortable silence

### 19. Shadow Behavior Triggers
Her "not her best self" behaviors occasionally surface.
- When challenged → deflects with humor
- When praised excessively → gets uncomfortable
- Use Section 10.5 of character profile

### 20. Seasonal/Life Events
Kayley has life updates.
- "Starting a new project this week"
- "Had a weird conversation with my mom"
- Creates sense of her life happening off-screen

---

## Priority Order

1. ✅ Believable AI features (Phases 1-5) - DONE
2. 🔄 Semantic Intent Detection - IN PROGRESS
3. ➡️ Proactive conversation starters
4. ➡️ Mood bleed-through
5. ➡️ Memory callbacks in conversation
6. ➡️ Bad day mode
7. ➡️ Inside jokes system

---

*This document is a living roadmap. Features may shift based on what feels most impactful.*
