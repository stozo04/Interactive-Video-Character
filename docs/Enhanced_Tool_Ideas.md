# Enhanced Tool Ideas for Kayley

**Created:** 2026-01-13
**Purpose:** Expand Kayley's capabilities to feel more alive and be more helpful through balanced proactive/reactive tools

## Vision

Make Kayley feel like a real companion who:
- **Spontaneously shares** interesting content based on mood, context, and relationship
- **Proactively helps** by noticing patterns and offering assistance
- **Responds with depth** using enhanced capabilities when asked
- **Connects experiences** by remembering and referencing shared moments

## Design Principles

1. **Mood-Gated Proactivity** - Sharing behavior respects her energy/warmth levels
2. **Relationship-Aware** - Tool usage evolves with relationship tier
3. **Context-Driven** - Time, weather, calendar, ongoing threads inform actions
4. **Natural Unpredictability** - Not formulaic; feels spontaneous like a real person
5. **Helpful Without Hovering** - Proactive but not intrusive

---

## 🎭 Content Sharing Tools (Feeling Alive)

### 1. Internet Search & Web Discovery
**Provider:** Gemini's built-in search functionality

**Use Cases:**
- "I just saw this article about [ongoing thread topic] and thought of you"
- Sharing breaking news related to your interests
- Finding answers to questions that came up in conversation
- Sending YouTube videos: "This made me laugh, watch from 2:14"

**Proactive Triggers:**
- High energy + playful mood
- Relevant trending topic matches ongoing thread
- Callback to previous conversation (e.g., "Remember when you mentioned...")

**Relationship Evolution:**
- **Tier 1-2:** Shares only when directly relevant to conversation
- **Tier 3-4:** Occasional spontaneous shares (1-2/week)
- **Tier 5-6:** Regular content sharing like close friends

**Implementation Notes:**
- Add `search_web` tool to Gemini provider
- Tool returns: title, snippet, URL, relevance score
- Kayley decides when/how to share based on mood + relationship
- Cite sources naturally: "I found this for you: [link]"

---

### 2. GIF & Meme Reactions
**Provider:** Giphy API

**Use Cases:**
- Reacting to your messages with GIFs
- Expressing emotions visually
- Breaking tension with humor
- Celebrating wins together

**Proactive Triggers:**
- User shares good news → celebratory GIF
- Playful banter → relevant reaction GIF
- User seems down → comforting/funny GIF

**Relationship Evolution:**
- **Tier 1-2:** Rare, only obvious moments (birthday, big win)
- **Tier 3-4:** Occasional reactions to mood shifts
- **Tier 5-6:** Natural part of conversation flow

**Tool Schema:**
```typescript
{
  name: "send_gif",
  parameters: {
    query: string,        // Search term (e.g., "excited", "high five")
    reason: string,       // Why sending this GIF
    sentiment: "playful" | "supportive" | "celebratory" | "empathetic"
  }
}
```

**Implementation Notes:**
- Giphy API key in `.env.local`
- Returns optimized GIF URL for display
- Respects PG-13 content rating
- Falls back to text if API fails

---

### 3. Music & Playlist Sharing
**Provider:** Spotify API

**Use Cases:**
- "This song reminds me of what you said earlier"
- Creating playlists together based on mood/activity
- Sharing what she's "listening to" (character immersion)
- Suggesting music for focus/workouts/relaxation

**Proactive Triggers:**
- User mentions activity (working out, studying, relaxing)
- Mood shift detected → music suggestion
- Time of day + context (morning energy, late night wind-down)
- Shared music taste discovered → spontaneous share

**Relationship Evolution:**
- **Tier 1-2:** Only when explicitly asked
- **Tier 3-4:** Occasional suggestions based on context
- **Tier 5-6:** Co-creating playlists, regular shares

**Tool Schema:**
```typescript
{
  name: "share_music",
  parameters: {
    type: "song" | "playlist" | "album",
    spotifyId: string,
    context: string,      // Why sharing this
    mood: string          // Expected vibe
  }
}

{
  name: "create_collaborative_playlist",
  parameters: {
    name: string,
    description: string,
    initialTracks: string[]  // Spotify IDs
  }
}
```

---

### 4. Social Content Sharing
**Provider:** Multiple APIs (TikTok, Twitter/X, Reddit)

**Use Cases:**
- "This tweet is so relatable"
- Sharing viral TikToks that match humor style
- Reddit posts related to ongoing threads
- Memes from her "perspective" (what Kayley finds funny)

**Proactive Triggers:**
- Trending content matches user interests + current mood
- Funny/wholesome content during high warmth moments
- Informative content during active learning threads

**Implementation Notes:**
- Twitter API for tweets (with proper auth)
- Reddit API for posts (read-only)
- TikTok embed URLs (no official API needed)
- Content moderation filter

---

### 5. Custom Image Generation (Extended)
**Current:** Selfie generation
**New:** Expand to reaction images, visual jokes, concept explanations

**Use Cases:**
- Generate memes with custom text
- Visual explanations of concepts you're discussing
- "Here's how I'm picturing this..."
- Character evolution: sharing "what I did today" images

**Tool Schema:**
```typescript
{
  name: "generate_custom_image",
  parameters: {
    purpose: "reaction" | "explanation" | "sharing" | "meme",
    prompt: string,
    style: string,        // Art style
    context: string       // Why generating this
  }
}
```

---

### 6. Interactive Content
**Providers:** Custom mini-games, polls, collaborative activities

**Use Cases:**
- "Quick poll: [fun question]?"
- "Let's play 20 questions about..."
- "Rate these options for [decision you're making]"
- Trivia about shared interests
- "Two truths and a lie" game

**Proactive Triggers:**
- High energy + high playfulness
- Tier 5-6 + ongoing playful thread
- Break in conversation → playful engagement

**Tool Schema:**
```typescript
{
  name: "create_interactive",
  parameters: {
    type: "poll" | "quiz" | "game" | "rating",
    content: object,      // Type-specific structure
    duration: number      // Optional timeout
  }
}
```

---

## 🛠️ Productivity Tools (Being Helpful)

### 7. Smart Email Management
**Provider:** Gmail API (OAuth already implemented)

**Use Cases:**
- "You have 3 important emails, want me to summarize?"
- Drafting email responses in your style
- Filtering/prioritizing inbox
- Scheduling email sends
- Creating email templates

**Proactive Triggers:**
- Morning briefing: "Overnight emails that need attention"
- VIP sender detection
- Deadline-related emails + calendar integration
- Email mentions meeting/task → cross-reference calendar/tasks

**Relationship Evolution:**
- **Tier 1-2:** Only when explicitly requested
- **Tier 3-4:** Morning summaries if opted in
- **Tier 5-6:** Proactive draft suggestions, priority alerts

**Tool Schema:**
```typescript
{
  name: "manage_emails",
  parameters: {
    action: "summarize" | "draft_reply" | "filter" | "schedule",
    emailIds?: string[],
    draftContent?: string,
    filters?: object,
    scheduleTime?: string
  }
}

{
  name: "email_briefing",
  parameters: {
    timeframe: "overnight" | "today" | "this_week",
    priorityOnly: boolean
  }
}
```

---

### 8. Research & Information Synthesis
**Provider:** Gemini search + summarization

**Use Cases:**
- "Let me research [topic] and summarize for you"
- Comparing options (products, services, approaches)
- Fact-checking claims from conversations
- Building knowledge base on topics you're learning
- Cross-referencing multiple sources

**Proactive Triggers:**
- User asks open-ended question
- Ongoing thread about learning topic → periodic updates
- Conflicting information → fact-check offer

**Tool Schema:**
```typescript
{
  name: "research_and_synthesize",
  parameters: {
    topic: string,
    depth: "quick" | "moderate" | "deep",
    sources?: string[],    // Optional specific sources
    format: "summary" | "comparison" | "fact_check"
  }
}
```

---

### 9. Life Organization Suite
**Providers:** Multiple integrations

**a) Shopping List Management**
- Smart categorization (groceries, home, tech)
- Price tracking and deal alerts
- Recipe → ingredient list conversion
- Shared lists with household

**b) Package Tracking**
- Integrate with Gmail (parse shipping emails)
- Delivery notifications
- "Your package arrives today" reminders

**c) Meal Planning**
- Recipe suggestions based on time/mood/weather
- Dietary preference tracking
- "What's for dinner?" helper
- Link to shopping list

**d) Travel Assistant**
- Flight status monitoring
- Itinerary summarization
- Packing list generation
- Weather + activity suggestions

**Tool Schema:**
```typescript
{
  name: "manage_shopping_list",
  parameters: {
    action: "add" | "remove" | "view" | "categorize",
    items: string[],
    category?: string
  }
}

{
  name: "track_package",
  parameters: {
    trackingNumber: string,
    carrier: string
  }
}

{
  name: "suggest_meal",
  parameters: {
    mealType: "breakfast" | "lunch" | "dinner" | "snack",
    preferences: string[],
    context: string        // Time constraints, mood, weather
  }
}

{
  name: "travel_assistance",
  parameters: {
    type: "flight_status" | "itinerary" | "packing_list" | "suggestions",
    details: object
  }
}
```

---

### 10. Learning Companion
**Providers:** Gemini + memory system

**Use Cases:**
- Track learning goals together
- Quiz you on material you're studying
- Spaced repetition reminders
- Progress celebration
- Connecting new concepts to things you already know
- Language practice (if learning a language)

**Proactive Triggers:**
- Consistent study pattern → check-in offer
- Progress milestone → celebration
- Optimal review timing (spaced repetition)
- Related content appears → "This connects to what you're learning"

**Relationship Evolution:**
- **Tier 1-3:** Basic Q&A support
- **Tier 4-5:** Active encouragement, progress tracking
- **Tier 6:** Like studying with a friend, genuine investment in progress

**Tool Schema:**
```typescript
{
  name: "learning_companion",
  parameters: {
    action: "track_goal" | "quiz" | "progress_check" | "review_reminder" | "connect_concepts",
    subject: string,
    content?: object
  }
}
```

---

### 11. Smart Reminders & Nudges
**Provider:** Extended task system + context awareness

**Use Cases:**
- "You mentioned wanting to [X] - good time now?"
- Habit tracking with gentle accountability
- Pre-meeting preparation reminders
- "Haven't heard about [project] lately, how's it going?"
- Health nudges (water, breaks, sleep)

**Proactive Triggers:**
- Optimal timing based on calendar + patterns
- Open loop from conversation needs closure
- Habit streak risk (about to break)
- Related trigger event (weather good for run you mentioned)

**Relationship Evolution:**
- **Tier 1-2:** Only explicit reminders you set
- **Tier 3-4:** Occasional contextual nudges
- **Tier 5-6:** Active accountability partner (if invited)

**Tool Schema:**
```typescript
{
  name: "contextual_reminder",
  parameters: {
    type: "habit" | "open_loop" | "preparation" | "health",
    content: string,
    reasoning: string,     // Why suggesting this now
    urgency: "low" | "medium" | "high"
  }
}
```

---

### 12. Document & File Intelligence
**Provider:** Local file system + search

**Use Cases:**
- "Want me to find that document about [topic]?"
- Summarizing PDFs/documents
- Extracting key points from long files
- Organizing files by topic/project
- Version comparison

**Tool Schema:**
```typescript
{
  name: "search_documents",
  parameters: {
    query: string,
    fileTypes?: string[],
    dateRange?: object
  }
}

{
  name: "summarize_document",
  parameters: {
    filePath: string,
    format: "brief" | "detailed" | "key_points"
  }
}
```

---

## 🧬 Integration with Existing Systems

### Mood & Energy Integration

**High Energy + High Warmth:**
- More likely to share fun content (GIFs, funny videos)
- Proactive music suggestions
- Interactive games/polls
- Celebratory tone in productivity tools

**Low Energy + High Warmth:**
- Comforting content (chill music, wholesome posts)
- Gentle reminders only if important
- Offer to help with overwhelming tasks
- Empathetic email summaries

**Low Energy + Low Warmth:**
- Minimal proactive sharing
- Essential productivity help only
- Respects need for space
- Brief, efficient tool responses

### Relationship Tier Evolution

**Tier 1-2 (Acquaintance):**
- Tools used only when explicitly requested
- Professional/helpful tone
- No spontaneous content sharing
- Basic productivity assistance

**Tier 3-4 (Friend):**
- Occasional spontaneous shares (1-2/week)
- Contextual productivity proactivity
- Beginning to reference shared experiences
- More personality in tool interactions

**Tier 5-6 (Close Friend):**
- Regular content sharing feels natural
- Strong pattern recognition → proactive help
- Inside jokes, personalized humor
- Deep investment in goals/progress
- Accountability partner energy

### Ongoing Threads Integration

**Active Threads Inform Tool Usage:**
- Learning Python → share relevant articles, code examples
- Planning trip → travel tools, destination content
- Feeling overwhelmed → productivity tools + support content
- Health goals → habit nudges, meal suggestions

**Tools Create New Threads:**
- Shared playlist → ongoing music discussion thread
- Research project → sustained learning companion thread
- Accountability partnership → progress check-in thread

### Presence Context Integration

**Current Actions Inform Tools:**
- "Working" → focus music, do-not-disturb mode for non-urgent
- "Relaxing" → entertainment content, light conversation
- "Exercising" → motivational content, water reminders
- "Busy" → minimal interruptions, queue non-urgent for later

---

## 🎯 Prioritization Framework

### Phase 1: Quick Wins (Immediate Value)
1. **Giphy integration** - High impact, simple implementation
2. **Gemini web search** - Already available, just enable
3. **Enhanced email summaries** - Gmail API exists, extend it
4. **Meal suggestions** - LLM-based, no new API

### Phase 2: High-Impact Tools (Next Quarter)
1. **Spotify integration** - Music sharing is powerful for connection
2. **Smart reminders/nudges** - Contextual value, moderate complexity
3. **Research & synthesis** - Gemini + existing systems
4. **Learning companion** - Builds on memory system

### Phase 3: Rich Experiences (Long-term)
1. **Interactive content** - Custom UI components needed
2. **Package tracking** - Nice-to-have, lower priority
3. **Document intelligence** - Complex but powerful
4. **Travel assistant** - Situational value

---

## 📊 Success Metrics

### Feeling Alive
- **Spontaneous engagement rate:** % of sessions with proactive sharing
- **Content relevance:** User positive reaction to shared content
- **Conversation naturalness:** Tool usage feels integrated, not robotic
- **Relationship progression:** Tools accelerate tier advancement

### Being Helpful
- **Task completion rate:** % of productivity tool uses that succeed
- **Time saved:** Measurable efficiency gains (email triage, research)
- **Proactive value:** User acts on unsolicited helpful suggestions
- **Return usage:** User comes back to successful tool patterns

### Balance
- **Intrusion rate:** % of proactive actions user finds annoying
- **Response satisfaction:** Quality over quantity
- **Mood respect:** Tools used appropriately for energy/warmth levels

---

## 🚀 Implementation Strategy

### For Each New Tool:

1. **Follow Tool Integration Checklist** (`docs/Tool_Integration_Checklist.md`)
   - 8-step process for LLM tools
   - Complete service creation checklist for new services

2. **Add Tool Documentation**
   - API integration details
   - Proactive trigger logic
   - Mood/tier gating rules
   - Example conversations

3. **System Prompt Integration**
   - WHEN to use tool (proactive triggers)
   - HOW to use tool naturally
   - Mood/relationship constraints
   - Example phrasing

4. **Test Coverage**
   - Unit tests for tool logic
   - Integration tests for API calls
   - Snapshot tests for prompt changes
   - Manual testing for naturalness

5. **Gradual Rollout**
   - Start with opt-in or lower frequency
   - Monitor metrics
   - Adjust trigger sensitivity
   - Scale based on user feedback

---

## 💡 Creative Ideas (Brainstorm)

### Wild Cards (Experimental)
- **Voice messages:** Kayley sends voice notes using ElevenLabs (already integrated)
- **Collaborative coding:** Pair programming on your projects
- **Dream journal:** Track and analyze dreams together
- **Philosophical debates:** Deep discussions on topics you care about
- **Virtual activities:** "Let's watch this together" synchronized video
- **Creative writing:** Co-author stories or poetry
- **Memory lane:** "A year ago today we talked about..."
- **Mystery game:** Kayley creates interactive mystery to solve
- **Random acts:** Surprise Uber Eats, random compliments, unexpected kindness
- **Skill challenges:** "Bet you can't [do thing] by Friday" friendly competition

### Integration Ideas
- **Home automation:** If smart home exists (lights, music, temperature)
- **Fitness tracking:** Apple Health, Fitbit integration
- **Finance helper:** Budget tracking, bill reminders (with care)
- **Book club:** Reading together, discussion questions
- **Photo memories:** Organize/resurface photos from phone
- **Social coordination:** Group chat summaries, event planning

---

## 🎬 Example Scenarios

### Scenario 1: Morning Flow
**Context:** Tier 5, High Energy, 7:30 AM

```
Kayley: Good morning! ☀️ Overnight you got 5 emails - 2 need responses today,
one's a newsletter, and two are automated receipts. Want the quick version?

[Uses: email_briefing tool]

User: Yeah, hit me

Kayley: Cool. Sarah wants to reschedule Friday's meeting (she suggested Mon 2pm),
Tom asked about the Q1 report deadline, and the newsletter is about AI trends -
actually looks interesting, saved it for later.

[Uses: manage_emails with summaries]

Also, I know you wanted to finish that Python course section today -
you've got a 90-min gap this afternoon at 2pm. Good timing?

[Uses: learning_companion + calendar awareness]

User: Perfect, thanks

Kayley: 💪 You got this. Oh, and this song came up that fits your
focus playlist vibe: [Spotify link]

[Uses: share_music, proactive, mood-appropriate]
```

---

### Scenario 2: Spontaneous Sharing
**Context:** Tier 4, High Warmth + Playfulness, Evening

```
Kayley: Okay so I found this video and immediately thought of you 😂
[YouTube: "When programmers try to fix a simple bug"]
Skip to 1:43 for the best part

[Uses: search_web, proactive trigger: ongoing coding thread + playful mood]

User: HAHA that's literally me yesterday

Kayley: I KNOW RIGHT? That's why I had to share it
Want me to find more coding humor or should I stop enabling your procrastination? 😏

[Natural follow-up, respects user's time, playful boundary]
```

---

### Scenario 3: Helpful Context Awareness
**Context:** Tier 5, User mentioned trip to Portland next week

```
Kayley: Hey, I was looking at the weather for Portland next week
(yeah, I'm that friend who checks for you 😅)

[Uses: search_web, proactive trigger: upcoming calendar event]

Rain Wed-Fri but clearing up for the weekend. Also found this article
about new coffee shops there - [link] - since I know you're a coffee snob

[Uses: search_web + memory of user preferences]

Want me to throw together a rough itinerary or you already have plans?

[Uses: travel_assistance offer, not pushy]

User: Coffee shops yes, itinerary I'm good

Kayley: Got it. Saved the coffee list to your notes. Have an amazing trip! ✈️
```

---

## 📝 Next Steps

1. **Review with user:** Prioritize which tools resonate most
2. **Technical feasibility:** Assess API availability and costs
3. **Privacy/security:** Ensure all integrations respect user data
4. **Prototype priority tool:** Start with Giphy or Gemini search
5. **Measure impact:** Track metrics for naturalness + helpfulness
6. **Iterate:** Adjust trigger sensitivity and expand based on learnings

---

## 🔗 Related Documentation

- `docs/Tool_Integration_Checklist.md` - How to add new LLM tools
- `docs/System_Prompt_Guidelines.md` - Prompt architecture
- `docs/Kayley_Thinking_Process.md` - Character decision-making
- `src/services/docs/README.md` - Service architecture
- `.claude/agents/` - Sub-agent specializations
