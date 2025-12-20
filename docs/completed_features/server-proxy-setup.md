# Server-Side Proxy Setup for Gemini Interactions API

Since you're using **Vite** (not Next.js), you need a separate backend server to proxy Gemini API calls and avoid CORS.

## Option 1: Simple Express Server (Recommended)

### Step 1: Install Express

```bash
npm install express cors dotenv
npm install --save-dev @types/express @types/cors
```

### Step 2: Create Backend Server

Create `server.js` in your project root:

```javascript
// server.js
import express from 'express';
import cors from 'cors';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = 3001; // Different port from Vite (3000)

app.use(cors()); // Allow requests from localhost:3000
app.use(express.json());

const genai = new GoogleGenAI({ 
  apiKey: process.env.VITE_GEMINI_API_KEY 
});

// Proxy endpoint for Interactions API
app.post('/api/gemini/interactions', async (req, res) => {
  try {
    const { model, input, previous_interaction_id, systemInstruction, tools } = req.body;
    
    const config = {
      model: model || 'gemini-2.5-flash',
      input: input,
    };
    
    if (previous_interaction_id) {
      config.previous_interaction_id = previous_interaction_id;
    } else if (systemInstruction) {
      config.systemInstruction = systemInstruction;
    }
    
    if (tools) {
      config.tools = tools;
    }
    
    const interaction = await genai.interactions.create(config);
    res.json(interaction);
  } catch (error) {
    console.error('Gemini API Error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Proxy server running on http://localhost:${PORT}`);
});
```

### Step 3: Update package.json

Add a script to run both servers:

```json
{
  "scripts": {
    "dev": "vite",
    "dev:server": "node server.js",
    "dev:all": "concurrently \"npm run dev\" \"npm run dev:server\"",
    // ... other scripts
  }
}
```

Install concurrently:
```bash
npm install --save-dev concurrently
```

### Step 4: Update geminiChatService.ts

Modify the Interactions API calls to use your proxy:

```typescript
// In callProviderWithInteractions method, replace:
let interaction = await ai.interactions.create(interactionConfig);

// With:
let interaction;
if (USE_SERVER_PROXY) {
  // Use your backend proxy
  const response = await fetch('http://localhost:3001/api/gemini/interactions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(interactionConfig),
  });
  interaction = await response.json();
} else {
  // Direct call (will fail with CORS, but fallback handles it)
  interaction = await ai.interactions.create(interactionConfig);
}
```

## Option 2: Keep Feature Flag OFF (Simplest)

**Just don't use Interactions API yet:**

```env
VITE_USE_GEMINI_INTERACTIONS_API=false
```

- ✅ Old Chat API works perfectly from browser
- ✅ No CORS issues
- ✅ No backend needed
- ⚠️ Sends system prompt each time (but it works!)

## Option 3: Wait for Google

- Google may enable CORS for Interactions API
- When they do, our code will work automatically
- No changes needed

## Recommendation

**For now**: Keep `VITE_USE_GEMINI_INTERACTIONS_API=false` and use the old API. It works fine, and the token cost difference isn't critical if you're not at scale yet.

**When you need it**: Set up the Express proxy server (Option 1) when you actually need the token savings.
