# Kayley Presence Tracking Integration Guide

## Overview

This guide shows how to integrate Kayley's presence state tracking into App.tsx.

## What's Been Created

1. ✅ **Database Migration**: `supabase/migrations/create_kayley_presence_state.sql`
2. ✅ **Presence Service**: `src/services/kayleyPresenceService.ts`
3. ✅ **Presence Detector**: `src/services/kayleyPresenceDetector.ts`
4. ✅ **Imports Added**: Already added to App.tsx

## Integration Steps

### Step 1: Add Presence Detection After Kayley Responds

Find where Kayley's response is added to chat history (around line 1900-2000, search for `updatedHistory`).

**Add this code RIGHT AFTER the response is processed:**

```typescript
// Detect and track Kayley's presence state (what she's wearing/doing)
if (response.text_response && userId) {
  // Run in background (don't block response)
  detectKayleyPresence(response.text_response, message)
    .then(async (detected) => {
      if (detected && detected.confidence > 0.7) {
        // Determine expiration based on activity type
        const expirationMinutes = getDefaultExpirationMinutes(
          detected.activity,
          detected.outfit
        );

        await updateKayleyPresenceState(userId, {
          outfit: detected.outfit,
          mood: detected.mood,
          activity: detected.activity,
          location: detected.location,
          expirationMinutes,
          confidence: detected.confidence,
        });

        console.log('[App] Kayley presence detected:', detected);
      }
    })
    .catch(err => console.warn('[App] Presence detection error:', err));
}
```

### Step 2: Update Selfie Generation to Use Presence

Find the selfie generation code (around line 2411). **Replace the TODO section with:**

```typescript
// Generate the selfie image with multi-reference system
// First, get Kayley's current presence state
const kayleyState = await getKayleyPresenceState(userId);

const selfieResult = await generateCompanionSelfie({
  scene: selfieAction.scene,
  mood: selfieAction.mood,
  outfitHint: selfieAction.outfit_hint,
  // Enable multi-reference system
  userId,
  userMessage: message,
  conversationHistory: chatHistory.slice(-10).map(msg => ({
    role: msg.role === 'user' ? 'user' : 'assistant',
    content: msg.text,
  })),
  // Calendar events integration
  upcomingEvents: upcomingEvents.map(event => ({
    title: event.summary,
    startTime: new Date(event.start.dateTime || event.start.date || ''),
    isFormal: event.summary.toLowerCase().includes('dinner') ||
             event.summary.toLowerCase().includes('meeting') ||
             event.summary.toLowerCase().includes('presentation'),
  })),
  // Kayley's presence state - NOW INTEGRATED! 🎉
  presenceOutfit: kayleyState?.currentOutfit,
  presenceMood: kayleyState?.currentMood,
});
```

## How It Works

### Example Flow:

1. **User**: "Send me a selfie"
2. **Kayley**: "I'm actually in the middle of a battle with a pickle jar right now and losing badly, but let me snap a quick one for you... 📸✨"
3. **Presence Detector** analyzes response:
   ```json
   {
     "activity": "battling a pickle jar",
     "location": "in the kitchen",
     "confidence": 0.9
   }
   ```
4. **Presence Service** stores state:
   - `current_activity`: "battling a pickle jar"
   - `current_location`: "in the kitchen"
   - `expires_at`: 15 minutes (quick activity)
5. **Selfie Generation** uses state:
   - Scene: "sitting on my couch" (from intent)
   - Presence: "battling a pickle jar" (from state)
   - → Selects `messy_bun_casual` (practical hair for kitchen activity)
   - → Kitchen scene overrides couch

### State Expiration:

- **Quick activities** (15 min): "making coffee", "getting ready"
- **Medium activities** (2 hours): "working", "at the gym"
- **Outfits** (4 hours): "wearing my hoodie", "in my pajamas"

### State Persistence:

Presence state persists across:
- Multiple selfie requests
- Page refreshes
- Different conversations

Until it expires or Kayley mentions a new state.

## Testing

### Test 1: Activity Detection
```
User: "Send me a selfie"
Kayley: "Just making myself some coffee ☕"
Expected: Detects activity: "making coffee", expires in 15 min
```

### Test 2: Outfit Detection
```
User: "What are you up to?"
Kayley: "Just relaxing in my favorite oversized hoodie"
Expected: Detects outfit: "in my favorite oversized hoodie", expires in 4 hours
```

### Test 3: Selfie Context
```
User: "Send me a selfie" (while "battling a pickle jar" is active)
Expected: Selfie reflects kitchen/casual context
```

## Debugging

Enable detailed logs:
```typescript
console.log('[App] Kayley presence state:', await getKayleyPresenceState(userId));
```

Check database:
```sql
SELECT * FROM kayley_presence_state WHERE user_id = 'your-email@gmail.com';
```

## Files Modified

- ✅ `src/App.tsx` - Added imports
- ⏳ `src/App.tsx` - Need to add detection + selfie integration (Steps 1 & 2 above)

## Migration

Run in Supabase SQL Editor:
```sql
-- From: supabase/migrations/create_kayley_presence_state.sql
```

## Summary

With this integration:
- ✅ Kayley's current state is automatically tracked
- ✅ Selfies reflect what she's doing/wearing
- ✅ State expires naturally based on activity type
- ✅ No manual updates needed - fully automatic!

**Result**: Selfies will now match Kayley's current context! 🎉
