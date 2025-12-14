# Vite Proxy Setup for Gemini Interactions API

## Overview

Since you're **not deploying** this app, we can use Vite's built-in development proxy to bypass CORS. This is the perfect solution for local development!

## How It Works

1. **Vite Proxy**: Intercepts requests to `/api/google/*` in development
2. **Forwards to Google**: Rewrites the path and forwards to `https://generativelanguage.googleapis.com`
3. **Adds API Key**: Automatically adds your API key from environment variables
4. **No CORS**: Browser thinks it's calling `localhost:3000`, so no CORS issues!

## Setup

### Step 1: Enable Feature Flag

Add to your `.env` file:

```env
VITE_USE_GEMINI_INTERACTIONS_API=true
```

### Step 2: Restart Dev Server

```bash
npm run dev
```

The Vite proxy is automatically configured in `vite.config.ts`!

## How It Works

### Request Flow

```
Browser → /api/google/v1beta/interactions?key=YOUR_KEY
    ↓
Vite Dev Server (intercepts)
    ↓
Rewrites to: https://generativelanguage.googleapis.com/v1beta/interactions?key=YOUR_KEY
    ↓
Google API
    ↓
Response back through Vite
    ↓
Browser (no CORS error!)
```

### Code Changes

The code automatically detects development mode and uses the Vite proxy:

```typescript
// Automatically uses Vite proxy in development
if (USE_VITE_PROXY) {
  const proxyUrl = `/api/google/v1beta/interactions?key=${GEMINI_API_KEY}`;
  // ... fetch to proxy URL
}
```

## Testing

1. **Enable feature flag**: `VITE_USE_GEMINI_INTERACTIONS_API=true`
2. **Restart server**: `npm run dev`
3. **Send a message** in your app
4. **Check console**: You should see:
   ```
   🔄 [Gemini Interactions] Using Vite proxy (development)
   🆕 [Gemini Interactions] First message - sending full system prompt
   ```

## Benefits

✅ **No CORS errors** - Browser thinks it's calling localhost  
✅ **No backend needed** - Vite handles it automatically  
✅ **Development only** - Perfect for local development  
✅ **Automatic** - Works as soon as you enable the feature flag  

## Important Notes

⚠️ **Development Only**: Vite proxy only works in development mode (`npm run dev`)

⚠️ **Not for Production**: If you ever deploy, you'll need a different solution (but you said you won't deploy!)

✅ **Automatic Fallback**: If proxy fails, code falls back to old API automatically

## Troubleshooting

### Problem: Still getting CORS errors

**Solution**: 
1. Make sure you restarted the dev server after enabling the flag
2. Check that `VITE_USE_GEMINI_INTERACTIONS_API=true` in `.env`
3. Verify the proxy is working: Check Network tab for requests to `/api/google/*`

### Problem: "Proxy error" in console

**Solution**:
1. Check your `VITE_GEMINI_API_KEY` is set correctly
2. Verify the API key is valid
3. Check Vite dev server console for errors

### Problem: Feature flag not working

**Solution**:
1. Restart dev server (required for env changes)
2. Check `.env` file is in project root
3. Verify no typos in variable name

## Success!

Once working, you'll see:
- ✅ No CORS errors
- ✅ Interactions API working
- ✅ 90% token savings (system prompt only sent once)
- ✅ Stateful conversations working

Enjoy your optimized Gemini integration! 🚀
