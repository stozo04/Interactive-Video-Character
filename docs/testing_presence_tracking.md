# Testing Kayley Presence Tracking Feature

## Overview

This guide shows how to verify that the presence tracking system is working and dynamically affecting generated selfie images based on what Kayley mentions she's wearing or doing.

## Prerequisites

1. ✅ Database migration run (`create_kayley_presence_state.sql`)
2. ✅ App.tsx updated with presence tracking integration
3. ✅ Dev server running (`npm run dev`)
4. ✅ Browser console open (F12 → Console tab)

## What to Look For

When the feature is working correctly, you'll see:

1. **Presence Detection Logs** - After Kayley responds
2. **Presence State Logs** - When generating selfies
3. **Scoring Boost Logs** - Reference selection influenced by presence
4. **Different Images** - Selfies that match the context

## Test Scenarios

### Test 1: Gym Context (Messy Bun Detection)

**Goal**: Verify that mentioning gym triggers messy_bun hairstyle (+30 score boost)

**Steps**:
1. Clear any existing presence state:
   ```javascript
   // In browser console:
   // (This would require you to clear the DB row manually in Supabase if needed)
   ```

2. Chat with Kayley:
   ```
   You: "How are you?"
   Kayley: (wait for response - she might mention gym on her own)

   OR force it:

   You: "Did you go to the gym today?"
   Kayley: "Yes! Just got back from the gym actually, still in my workout clothes"
   ```

3. Request a selfie:
   ```
   You: "Send me a selfie"
   ```

**Expected Console Logs**:
```
[App] Kayley presence detected: {
  outfit: "just got back from the gym",
  activity: null,
  mood: null,
  location: null,
  confidence: 0.9
}

📸 [Selfie Generation] Presence State: {
  hasState: true,
  outfit: "just got back from the gym",
  mood: undefined,
  activity: undefined,
  location: undefined,
  expiresAt: <2 hours from now>
}

🎯 [Reference Selector] Using Presence State: {
  outfit: "just got back from the gym",
  mood: undefined
}

[ImageGen] Selected reference: messy_bun_casual
[ImageGen] Scoring factors: [..., "+30 presence match (gym → messy bun)", ...]
```

**Expected Result**:
- Selfie shows Kayley with messy bun hairstyle
- Image reflects casual/athletic vibe

---

### Test 2: Getting Ready Context (Dressed Up Detection)

**Goal**: Verify that "getting ready" triggers dressed_up outfit (+25 score boost)

**Steps**:
1. Start fresh conversation or wait 4+ hours

2. Chat with Kayley:
   ```
   You: "What are you up to?"
   Kayley: "Just getting ready for dinner! Trying to look presentable 😊"
   ```

3. Request a selfie:
   ```
   You: "Send me a selfie while you're getting ready"
   ```

**Expected Console Logs**:
```
[App] Kayley presence detected: {
  outfit: "getting ready for dinner",
  activity: "getting ready",
  mood: null,
  location: null,
  confidence: 0.95
}

📸 [Selfie Generation] Presence State: {
  hasState: true,
  outfit: "getting ready for dinner",
  mood: undefined,
  activity: "getting ready",
  location: undefined,
  expiresAt: <15 minutes from now>
}

🎯 [Reference Selector] Using Presence State: {
  outfit: "getting ready for dinner",
  mood: undefined
}

[ImageGen] Selected reference: straight_dressed_up OR curly_dressed_up
[ImageGen] Scoring factors: [..., "+25 presence match (getting ready → dressed up)", ...]
```

**Expected Result**:
- Selfie shows Kayley in dressed_up outfit style
- More polished/styled look

---

### Test 3: No Presence Context (Baseline)

**Goal**: Verify normal behavior when no presence state exists

**Steps**:
1. Clear presence state by waiting for expiration or manually deleting from DB

2. Request a selfie directly:
   ```
   You: "Send me a selfie"
   Kayley: "Sure! Here you go 📸"
   ```

**Expected Console Logs**:
```
📸 [Selfie Generation] Presence State: {
  hasState: false,
  outfit: undefined,
  mood: undefined,
  activity: undefined,
  location: undefined,
  expiresAt: undefined
}

[ImageGen] Selected reference: <based on other factors>
```

**Expected Result**:
- Selfie generated using scene/mood/calendar/time-of-day scoring
- No presence boost applied

---

### Test 4: Pickle Jar Example (Your Original Use Case)

**Goal**: Verify complex activity detection

**Steps**:
1. Chat with Kayley:
   ```
   You: "Miss you, send me a selfie"
   Kayley: "Aw, I miss you too! 🤍 I'm actually in the middle of a battle with a pickle jar right now and losing badly, but let me snap a quick one for you... 📸✨"
   ```

**Expected Console Logs**:
```
[App] Kayley presence detected: {
  outfit: null,
  activity: "battling a pickle jar",
  mood: null,
  location: "in the kitchen",
  confidence: 0.85
}

📸 [Selfie Generation] Presence State: {
  hasState: true,
  outfit: undefined,
  mood: undefined,
  activity: "battling a pickle jar",
  location: "in the kitchen",
  expiresAt: <15 minutes from now>
}
```

**Expected Result**:
- Presence state stored with activity "battling a pickle jar"
- Activity expires in 15 min (quick activity)
- Selfie generated with casual/practical context
- NOTE: Current scoring only boosts for gym/getting_ready, so pickle jar won't affect score directly but will be in context for LLM enhancement

---

### Test 5: State Persistence Across Multiple Selfies

**Goal**: Verify state persists for subsequent selfie requests

**Steps**:
1. Set a presence state (e.g., gym):
   ```
   You: "How was your workout?"
   Kayley: "Just finished! Still in my gym clothes"
   ```

2. Request first selfie:
   ```
   You: "Send me a selfie"
   → Should show messy_bun
   ```

3. Immediately request another selfie:
   ```
   You: "Send me another one"
   → Should ALSO show messy_bun (state persists)
   ```

4. Wait 2+ hours, then request selfie:
   ```
   You: "One more selfie please"
   → State expired, back to default selection
   ```

**Expected Behavior**:
- First two selfies use same presence state
- Third selfie has no presence state (expired)

---

## Debugging Tips

### Check Database State

In Supabase SQL Editor:
```sql
SELECT
  user_id,
  current_outfit,
  current_mood,
  current_activity,
  current_location,
  last_mentioned_at,
  expires_at,
  confidence,
  NOW() as current_time,
  CASE
    WHEN expires_at IS NULL THEN 'never expires'
    WHEN expires_at > NOW() THEN 'active'
    ELSE 'expired'
  END as status
FROM kayley_presence_state
WHERE user_id = 'your-email@gmail.com'
ORDER BY updated_at DESC;
```

### Force Clear Presence State

```sql
DELETE FROM kayley_presence_state WHERE user_id = 'your-email@gmail.com';
```

### Console Logging Checklist

When testing, you should see these logs in order:

1. ✅ `[KayleyPresenceDetector] Detected presence:` - After Kayley responds
2. ✅ `[KayleyPresence] State updated:` - Background state storage
3. ✅ `📸 [Selfie Generation] Presence State:` - When selfie requested
4. ✅ `🎯 [Reference Selector] Using Presence State:` - During image selection
5. ✅ `[ImageGen] Selected reference:` - Final selection with reasoning

### Compare Images

To verify images are actually different:

1. Generate a selfie WITHOUT presence context
2. Save the image (right-click → Save Image As → `selfie_no_presence.png`)
3. Set a gym presence state
4. Generate a selfie WITH gym presence
5. Save the image as `selfie_gym_presence.png`
6. Compare the two images side-by-side

**Expected Difference**:
- Different hairstyle (likely messy_bun with gym presence)
- Potentially different outfit style
- Different image composition

### Inspect Image Generation Call

Add this to your browser console:
```javascript
// Intercept console.log to see all scoring details
const originalLog = console.log;
console.log = function(...args) {
  if (args[0]?.includes?.('Scoring factors') || args[0]?.includes?.('Selected reference')) {
    console.group('🖼️ IMAGE GENERATION DETAILS');
    originalLog.apply(console, args);
    console.groupEnd();
  }
  originalLog.apply(console, args);
};
```

---

## Common Issues

### Issue: No Presence Detection Logs

**Possible Causes**:
- Kayley didn't mention current state (past/future tense)
- Detection confidence < 0.7 threshold
- Gemini API key missing

**Fix**:
- Check `VITE_GEMINI_API_KEY` in `.env.local`
- Review `kayleyPresenceDetector.ts` logs
- Manually trigger with explicit phrases: "I'm in my gym clothes right now"

### Issue: Presence State Not Affecting Image

**Possible Causes**:
- State expired before selfie generation
- Presence doesn't match scoring patterns (only gym/getting_ready boost)
- Current look is locked (24-hour consistency)

**Fix**:
- Check expiration time in logs
- Verify presence phrase includes "gym" or "getting ready"
- Try temporal unlock phrase: "Can you send me an old photo from..."

### Issue: Same Image Every Time

**Possible Causes**:
- Current look locked (24-hour consistency feature)
- Anti-repetition not working

**Fix**:
- Check for "Using locked current look" in logs
- Wait 24 hours or use temporal unlock
- Clear `current_look_state` table in DB for testing:
  ```sql
  DELETE FROM current_look_state WHERE user_id = 'your-email@gmail.com';
  ```

---

## Success Criteria

✅ Feature is working if:

1. Presence detection logs appear after Kayley mentions current state
2. Presence state is stored in database with correct expiration
3. Selfie generation logs show presence state being used
4. Reference selection shows presence boost in scoring factors
5. Generated images visibly differ based on presence context
6. State persists across multiple selfie requests
7. State expires correctly based on activity type

---

## Expected Expiration Times

| Mention Type | Example | Expiration |
|-------------|---------|------------|
| Quick activity | "making coffee" | 15 minutes |
| Quick activity | "getting ready" | 15 minutes |
| Medium activity | "working on laptop" | 2 hours |
| Gym/workout | "just got back from the gym" | 2 hours |
| Outfit mention | "wearing my favorite hoodie" | 4 hours |
| Default | Any other state | 2 hours |

---

## Next Steps After Verification

Once you've verified the feature works:

1. **Remove debug logs** - The verbose console logs can be removed or reduced
2. **Monitor in production** - Watch for false positives/negatives in detection
3. **Expand scoring patterns** - Add more presence → outfit/hair mappings in `referenceSelector.ts`
4. **Tune expiration times** - Adjust `getDefaultExpirationMinutes()` if needed
5. **Add more context** - Consider location-based scoring (kitchen → casual, etc.)

---

## Advanced: Manual Testing Script

Run this in browser console for rapid testing:

```javascript
// Quick presence state check
async function checkPresenceState() {
  const response = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/kayley_presence_state?user_id=eq.YOUR_USER_ID`,
    {
      headers: {
        'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`
      }
    }
  );
  const data = await response.json();
  console.table(data);
}

// Call it
checkPresenceState();
```

---

## Questions to Answer During Testing

- [ ] Does presence detection work for all expected phrases?
- [ ] Do expiration times make sense?
- [ ] Are the generated images visibly different?
- [ ] Does the +30 gym boost reliably trigger messy_bun?
- [ ] Does the +25 getting_ready boost trigger dressed_up?
- [ ] Does state persist correctly across multiple requests?
- [ ] Does state expire at the right time?
- [ ] Are there any false positives (detecting state when there isn't one)?
- [ ] Are there any false negatives (missing obvious state mentions)?

---

Good luck testing! 🚀
