# Testing Guide: Gemini Interactions API

This guide will help you test the new stateful conversation implementation for Gemini.

## Step 1: Enable the Feature Flag

### Option A: Add to `.env` file (Recommended)

1. Open your `.env` file in the project root
2. Add this line:
   ```env
   VITE_USE_GEMINI_INTERACTIONS_API=true
   ```
3. Save the file
4. **Restart your development server** (this is critical!)
   ```bash
   # Stop the server (Ctrl+C)
   npm run dev
   ```

### Option B: Temporary Test (Quick)

If you want to test without modifying `.env`, you can temporarily change the code:

**File**: `src/services/geminiChatService.ts` (line 23)

**Change from:**
```typescript
const USE_INTERACTIONS_API = import.meta.env.VITE_USE_GEMINI_INTERACTIONS_API === 'true';
```

**Change to:**
```typescript
const USE_INTERACTIONS_API = true; // Temporary test
```

⚠️ **Remember to change it back after testing!**

---

## Step 2: Verify Feature Flag is Loaded

1. Open your browser's Developer Console (F12)
2. Look for this log message when the app loads:
   ```
   🆕 [Gemini Interactions] First message - sending full system prompt
   ```
   OR
   ```
   📜 [Gemini] Passing X session messages to chat history
   ```
   
   - **First message** = Interactions API is enabled ✅
   - **Second message** = Old API is still being used ❌

---

## Step 3: Test Basic Conversation Flow

### Test 1: First Message (System Prompt Sent)

1. Start a **fresh conversation** (new session)
2. Send your first message (e.g., "Hello!")
3. **Check the browser console** for:
   ```
   🆕 [Gemini Interactions] First message - sending full system prompt
   🧠 [Gemini Interactions] Memory tools enabled
   ```
4. **Verify**: You should see the AI respond normally

### Test 2: Second Message (No System Prompt)

1. **Without refreshing the page**, send a second message (e.g., "Tell me a joke")
2. **Check the browser console** for:
   ```
   🔄 [Gemini Interactions] Continuing conversation - using previous_interaction_id
   🧠 [Gemini Interactions] Memory tools enabled
   ```
3. **Key difference**: You should NOT see "First message" log
4. **Verify**: The AI should remember the conversation context

### Test 3: Verify Interaction ID is Stored

1. After sending a message, check the console
2. Look for any session-related logs
3. The `interactionId` should be stored in the session object
4. You can verify this by checking the Network tab:
   - Look for API calls to Gemini
   - Check if `previous_interaction_id` is being sent (for messages after the first)

---

## Step 4: Test Different Input Types

### Test Text Input
- ✅ Send a text message
- ✅ Verify response is normal

### Test Audio Input (if supported)
- ✅ Send an audio message
- ✅ Verify transcription and response work

### Test Image Input (if supported)
- ✅ Send an image with text
- ✅ Verify the AI can see and respond to the image

---

## Step 5: Test Tool Calling (Memory Tools)

1. Send a message that should trigger a memory tool:
   - "What's my name?" (should call `recall_user_info`)
   - "Remember I love pizza" (should call `store_user_info`)
2. **Check console** for:
   ```
   🔧 [Gemini Interactions] Tool call iteration 1: ['recall_user_info']
   🔧 [Gemini Interactions] Executing tool: recall_user_info
   ```
3. **Verify**: Tool calls should work correctly

---

## Step 6: Test Greeting

1. Start a new session (refresh the page)
2. The greeting should use Interactions API
3. **Check console** for:
   ```
   🧠 [Gemini Interactions Greeting] Memory tools enabled for personalization
   ```
4. **Verify**: Greeting works normally

---

## Step 7: Verify Token Savings

### Method 1: Check Network Tab

1. Open Browser DevTools → Network tab
2. Filter by "interactions" or "gemini"
3. Click on API requests
4. Check the **Request Payload** size:
   - **First message**: Should be large (contains system prompt)
   - **Second message**: Should be much smaller (no system prompt)

### Method 2: Check Console Logs

The logs will show which path is being used:
- `[Gemini Interactions]` = New API (stateful) ✅
- `[Gemini]` = Old API (stateless) ❌

### Method 3: Compare Token Usage

If you have access to Gemini API usage dashboard:
- Compare token usage before/after enabling the feature
- Should see ~90% reduction in input tokens for messages after the first

---

## Step 8: Test Error Handling

### Test: Invalid Interaction ID

1. Manually corrupt the session (in browser console):
   ```javascript
   // This simulates a lost/corrupted interaction ID
   localStorage.setItem('aiSession', JSON.stringify({
     interactionId: 'invalid-id-12345',
     userId: 'test-user'
   }));
   ```
2. Send a message
3. **Expected**: Should handle gracefully (either fallback to old API or create new interaction)

### Test: API Failure

1. Temporarily break your API key
2. Send a message
3. **Expected**: Should show error message, not crash

---

## Step 9: Test Session Persistence

1. Send a few messages in a conversation
2. **Refresh the page** (F5)
3. Send another message
4. **Verify**: 
   - Conversation context is maintained
   - Interaction ID is preserved
   - No "First message" log (should use `previous_interaction_id`)

---

## Step 10: Compare Old vs New API

### Side-by-Side Test

1. **Test with flag OFF**:
   - Set `VITE_USE_GEMINI_INTERACTIONS_API=false`
   - Send 3 messages
   - Note the console logs: `[Gemini]` (old API)

2. **Test with flag ON**:
   - Set `VITE_USE_GEMINI_INTERACTIONS_API=true`
   - Restart server
   - Send 3 messages
   - Note the console logs: `[Gemini Interactions]` (new API)

3. **Compare**:
   - Response quality should be identical
   - New API should have smaller request sizes after first message

---

## Troubleshooting

### Problem: Feature flag not working

**Symptoms**: Still seeing `[Gemini]` logs instead of `[Gemini Interactions]`

**Solutions**:
1. ✅ Verify `.env` file has `VITE_USE_GEMINI_INTERACTIONS_API=true`
2. ✅ Restart the development server (required!)
3. ✅ Check for typos in the variable name
4. ✅ Verify the variable is in the root `.env` file (not `.env.local`)

### Problem: "interactions.create is not a function"

**Symptoms**: Console error about `interactions` not existing

**Solutions**:
1. ✅ Check you're using the latest `@google/genai` package
2. ✅ Verify the package supports Interactions API (v1.33.0+)
3. ✅ Update package: `npm install @google/genai@latest`

### Problem: CORS Error (Most Common)

**Symptoms**: `Access to fetch at '...interactions' has been blocked by CORS policy`

**What This Means**:
- Google's Interactions API endpoint may not have CORS enabled for browser calls yet
- This is controlled by Google, not your code
- The code automatically falls back to the old API (which works fine)

**Solutions**:
1. ✅ **Automatic**: Code already handles this - it falls back to old API automatically
2. ✅ **Check Console**: You should see `⚠️ [Gemini Interactions] CORS/Connection error detected. Falling back to old API.`
3. ✅ **App Still Works**: The old Chat API is used, so your app functions normally
4. ⏳ **Wait for Google**: When Google enables CORS for Interactions API, it will work automatically
5. 🔧 **Alternative**: Use a server-side proxy if you need Interactions API now

**Note**: The CORS configuration in Google Cloud Console (Apigee, Cloud Functions, etc.) is for YOUR services, not Google's Gemini API endpoint. Google controls CORS for their own APIs.

### Problem: Tool calling not working

**Symptoms**: Tools aren't being called or executed

**Solutions**:
1. ✅ Check console for tool call logs
2. ✅ Verify `ENABLE_MEMORY_TOOLS` is `true`
3. ✅ Check tool function declarations are correct
4. ✅ Verify tool results are being sent back correctly

### Problem: Conversation context lost

**Symptoms**: AI doesn't remember previous messages

**Solutions**:
1. ✅ Check `interactionId` is being stored in session
2. ✅ Verify `previous_interaction_id` is being sent
3. ✅ Check console for errors
4. ✅ Verify session persistence is working

---

## Rollback Plan

If you encounter issues:

1. **Quick Rollback**: Set flag to `false`
   ```env
   VITE_USE_GEMINI_INTERACTIONS_API=false
   ```
2. **Restart server**
3. Old implementation will be used automatically
4. No data loss - sessions still work

---

## Success Criteria

✅ **All tests pass if:**
- First message shows "First message" log
- Subsequent messages show "Continuing conversation" log
- Tool calling works correctly
- Conversation context is maintained
- No errors in console
- Response quality is identical to old API
- Request sizes are smaller after first message

---

## Next Steps After Testing

Once you've verified everything works:

1. ✅ Monitor for 1-2 weeks in production
2. ✅ Check token usage reduction (should be ~90%+)
3. ✅ Watch for any API errors or issues
4. ✅ After stability confirmed, you can remove the old code path (optional)

---

## Quick Test Checklist

- [ ] Feature flag enabled in `.env`
- [ ] Server restarted
- [ ] First message works (check console)
- [ ] Second message uses `previous_interaction_id` (check console)
- [ ] Tool calling works
- [ ] Greeting works
- [ ] Session persistence works
- [ ] No errors in console
- [ ] Response quality is good
- [ ] Ready for production! 🚀

---

## Need Help?

If you encounter issues:
1. Check the console for error messages
2. Verify all environment variables are set
3. Check the Network tab for API request/response details
4. Compare with ChatGPT/Grok implementations (they use similar patterns)

Good luck testing! 🎉
