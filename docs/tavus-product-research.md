# Tavus Product & API Research

> Research date: 2026-02-08

---

## 1. Product Overview

### What is Tavus?

Tavus is an AI video platform that provides **real-time, face-to-face conversational video** powered by photorealistic digital humans. Their core product is the **Conversational Video Interface (CVI)** -- an end-to-end pipeline that enables AI agents to see, hear, and respond in real-time video conversations with sub-1-second latency.

Unlike competitors focused on pre-rendered video generation (HeyGen, Synthesia), Tavus differentiates on **real-time interactive conversation** -- the avatar responds dynamically, not from a script.

### Core Products

1. **CVI (Conversational Video Interface)** -- Developer API for embedding real-time video AI agents into applications. This is the primary developer product.
2. **PALs (Personal AI Companions)** -- Consumer-facing AI companions (Noah, Dominic, Ashley, Charlie, Chloe) that users can text, call, or video chat with. These are built on CVI.
3. **Video Generation API** -- Generate pre-recorded videos from scripts or audio using trained replicas. This is the traditional avatar video product.

### Key Concepts

| Concept | Description |
|---------|-------------|
| **Persona** | Defines the AI agent's behavior, tone, knowledge, system prompt, and CVI pipeline configuration |
| **Replica** | A photorealistic digital human avatar trained from video footage, rendered by Phoenix |
| **Conversation** | A real-time WebRTC video session connecting a persona + replica to an end user |

### Use Cases

- AI Interviewing (candidate screening at scale)
- Customer Service Agents
- Healthcare Consultants
- Sales Coaching
- Education / Tutoring
- Research Assistants

### Scale

Tavus claims to have powered over 2 billion interactions. They are SOC 2, GDPR, HIPAA, and BAA compliant.

---

## 2. Technology

### Proprietary Model Family

Tavus has built three proprietary models that power the CVI pipeline:

#### Phoenix (Rendering) -- Currently at version 4

- **Architecture**: Gaussian-diffusion rendering model
- **Function**: Synthesizes high-fidelity facial behavior in real-time
- **Key capability**: Full-face animation including eyebrows, cheeks, micro-expressions, and subtle muscle movements synchronized with speech
- **Evolution**:
  - Phoenix-1: Initial avatar generation model
  - Phoenix-2: Replaced NeRF backbone with 3D Gaussian Splatting (3DGS) for explicit scene representation. 3DGS uses localized Gaussian-distributed elements to represent 3D scenes, manipulating sparse Gaussian parameters (positions, amplitudes, spreads) directly rather than using neural networks for color/density prediction.
  - Phoenix-3: Full-face rendering with dynamic emotion control and micro-expressions. 70% faster training, 60+ FPS rendering.
  - Phoenix-4: Current version. Focuses on temporal consistency and precise motion/identity control. Targets ~500ms rendering latency.

**Technical details of 3DGS approach (Phoenix-2+)**:
- The model learns how audio deforms faces in 3D space
- Renders novel views from unseen audio input
- Advantages over NeRF: lower memory usage, less computational complexity, faster training, more efficient rendering (direct projection vs. ray sampling)
- Challenge: render quality for in-the-wild training videos

#### Raven (Perception) -- Version 0

- **Function**: Multimodal perception model
- **Capabilities**: Reads body language, facial cues, emotional state, gaze direction, environmental context, and screen content
- **Purpose**: Enables the AI to understand not just *what* is said but *how* it is said

#### Sparrow (Turn-Taking / Dialogue) -- Version 0

- **Function**: Conversational flow and turn-taking model
- **Capabilities**: Intelligent turn detection -- knows when to listen, pause, or respond
- **Latency**: Collapses conversational latency to ~600ms
- **Features**: Semantic and lexical turn-taking awareness, interruption handling

### Latency Performance

| Metric | Value |
|--------|-------|
| Utterance-to-utterance round-trip | < 1 second (SLA) |
| Typical response time | ~600ms |
| Phoenix rendering target | ~500ms |
| Video quality | 1080p |
| Audio quality | 24 kHz |
| Rendering FPS | 60+ FPS |

### CVI Seven-Layer Pipeline

The CVI is architected as a modular seven-layer pipeline:

| # | Layer | Technology | Function |
|---|-------|-----------|----------|
| 1 | **Transport** | WebRTC via Daily | Real-time audio/video streaming. Always enabled. Configurable mic/camera. |
| 2 | **Perception** | Raven model | Visual analysis: expressions, gaze, background, screen content |
| 3 | **Conversational Flow** | Sparrow model | Turn-taking dynamics, interruption handling, active listening |
| 4 | **STT** | Configurable | Speech-to-text with real-time lexical/semantic awareness |
| 5 | **LLM** | Configurable | Language model processing. Supports tavus-gpt-4o, tavus-llama, or custom LLMs |
| 6 | **TTS** | Cartesia (default), ElevenLabs, PlayHT | Text-to-speech with emotion control |
| 7 | **Realtime Replica** | Phoenix model | Synchronized digital human rendering |

Each layer is independently configurable through the Persona settings. The pipeline is "hyper-optimized" with layers tightly coupled for minimum latency.

---

## 3. API & Integration

### Base URL

```
https://tavusapi.com/v2/
```

### Authentication

All requests require an `x-api-key` header:
```
x-api-key: YOUR_API_KEY
```

### Core API Endpoints

#### Conversations
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/v2/conversations` | Create a new conversation (returns `conversation_url`) |
| GET | `/v2/conversations` | List conversations |
| GET | `/v2/conversations/{id}` | Get conversation details |
| DELETE | `/v2/conversations/{id}` | Delete a conversation |
| POST | `/v2/conversations/{id}/end` | End an active conversation |

#### Personas
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/v2/personas` | Create a persona (requires `system_prompt` in full pipeline mode) |
| GET | `/v2/personas` | List personas |
| GET | `/v2/personas/{id}` | Get persona details |
| PATCH | `/v2/personas/{id}` | Update persona (JSON Patch / RFC 6902) |
| DELETE | `/v2/personas/{id}` | Delete a persona |

#### Replicas
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/v2/replicas` | Create a replica (defaults to phoenix-3 model) |
| GET | `/v2/replicas` | List replicas |
| GET | `/v2/replicas/{id}` | Get replica details |
| DELETE | `/v2/replicas/{id}` | Delete a replica |

#### Video Generation
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/v2/videos` | Generate video from replica + script/audio |
| GET | `/v2/videos` | List generated videos |
| GET | `/v2/videos/{id}` | Get video details (includes download_url, stream_url, hosted_url) |
| DELETE | `/v2/videos/{id}` | Delete a video |

#### Documents (Knowledge Base)
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/v2/documents` | Create a document for persona knowledge |
| GET | `/v2/documents` | List documents |
| PATCH | `/v2/documents/{id}` | Update a document |
| DELETE | `/v2/documents/{id}` | Delete a document |
| POST | `/v2/documents/{id}/recrawl` | Re-crawl a website document |

### Creating a Basic Conversation (Minimal Example)

```bash
curl -X POST https://tavusapi.com/v2/conversations \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_API_KEY" \
  -d '{
    "replica_id": "rfe12d8b9597",
    "persona_id": "pdced222244b"
  }'
```

Response returns a `conversation_url` that can be embedded via iframe or joined via WebRTC.

### Real-Time Events (WebRTC Data Channel)

**Developer can broadcast to the conversation:**
- Append/Overwrite Conversational Context
- Echo (trigger TTS for specific text)
- Interrupt (stop replica from speaking)
- Text Respond (simulate user input)
- Sensitivity (tune VAD settings)

**Tavus broadcasts to developer:**
- Utterance events (content spoken by participants)
- Replica/User Started/Stopped Speaking
- Tool Call (LLM function call triggers)
- Perception Tool Call (vision-triggered actions)
- Perception Analysis (post-conversation summary)
- Replica Interrupted notification

### Frontend Integration Options

1. **React Components** (`@tavus/cvi-ui`):
   ```bash
   npm create vite@latest my-tavus-app -- --template react-ts
   npx @tavus/cvi-ui@latest init
   npx @tavus/cvi-ui@latest add conversation
   ```
   Uses `CVIProvider` wrapper and `Conversation` component.

2. **iframe embed**: Embed the `conversation_url` directly.

3. **Daily SDK**: Use the Daily.co WebRTC SDK for custom UI control.

4. **LiveKit Agent Integration**: For LiveKit-based architectures.

5. **Pipecat Framework**: Pipeline-based conversational AI framework support.

### Configuration Highlights

- Audio-only conversation mode (disable video)
- Green screen / custom background support
- Closed captions and live transcription
- Call duration and timeout limits
- Private rooms with authentication tokens
- Participant limits
- Conversation recording to S3
- Memory persistence across sessions
- 30+ language support

---

## 4. LLM Integration

### How Tavus Uses LLMs

The LLM layer is one of the seven configurable layers in the CVI pipeline. Tavus provides pre-optimized models but also supports bring-your-own-LLM.

### Built-in LLM Options

- `tavus-gpt-4o` -- Optimized GPT-4o for conversational use
- `tavus-gpt-4o-mini` -- Lighter/faster variant
- `tavus-llama` -- Llama-based model optimized for Tavus pipeline

### Llama Integration (via Meta partnership)

Tavus selected Llama as a replacement for closed-source models based on:
- Better conversational quality
- Faster response times
- Flexible, open-source design enabling on-premise deployment

**Performance with Llama:**
- Llama 70B processes ~2,000 tokens/second
- Cerebras inference: 440-550% better latency than high-latency models, 25-50% edge over comparable GPT models
- Uses Llama 3.2 and 3.3 (with multimodal capabilities)

**Llama-powered capabilities:**
1. Real-time conversational AI with context-aware interactions
2. Tool calling for dynamic function execution
3. Multi-image reasoning / visual question answering
4. Fine-tuned models + RAG for proprietary data integration

**Infrastructure:** Tested on vLLM (on-premises), Cerebras (cloud), and Fireworks (cloud). Uses vector databases and embedded models for storage and query optimization.

### Custom LLM Integration

Developers can:
- Use their own LLM by pointing the persona's LLM layer to a custom endpoint
- Use OpenAI Realtime API or other voice-to-voice models, with Tavus only driving the replica video
- Enable function/tool calling for Tavus-optimized LLMs
- Integrate RAG pipelines with the document/knowledge base system

---

## 5. Pricing

### Developer Plans

| Plan | Monthly Cost | CVI Minutes | Video Gen Minutes | Custom Replicas | Concurrent Streams | CVI Overage | Video Overage |
|------|-------------|-------------|-------------------|-----------------|-------------------|-------------|---------------|
| **Basic (Free)** | $0 | 25 min | 5 min | 0 | -- | -- | -- |
| **Starter** | $59 + usage | 100 min | 10 min | 3 trainings/mo | 3 | $0.37/min | $1.00/min |
| **Growth** | $397 + usage | 1,250 min | 100 min | 7 trainings/mo | 15 | $0.32/min | $0.90/min |
| **Enterprise** | Custom | Custom | Custom | Custom | Custom | Scaling discounts | Scaling discounts |

**Stock replicas**: Basic gets 25, Growth gets 100+. Enterprise is customizable.

### PALs (Consumer) Plans

| Plan | Cost | Interactions/mo |
|------|------|----------------|
| Free | $0 | 100 |
| Plus | $20/mo | 1,000 |
| Max | $50/mo | 3,150 |

**Interaction math:** 1 minute CVI/audio = 6.5 interactions. 1 text message = 1.2 interactions. Overages: $20 per 1,300 interactions.

### Cost Analysis

At Growth tier ($397/mo with 1,250 CVI minutes):
- Base cost per CVI minute: ~$0.32/min (included minutes)
- Overage rate: $0.32/min
- For a 10-minute conversation: ~$3.20
- For 1,000 daily 5-minute conversations: ~$16,000/month at overage rates

The pricing is **per-minute of conversation time**, which can scale significantly for high-volume use cases.

---

## 6. Strengths & Limitations

### Strengths

1. **Real-time interaction**: Sub-1-second latency for live, bidirectional video conversation. This is the core differentiator -- no competitor matches this for interactive video.
2. **Full-face rendering**: Phoenix-3/4 renders the entire face (not just lips), including micro-expressions and emotional nuance. 60+ FPS.
3. **Modular architecture**: Every layer (STT, LLM, TTS, rendering) is independently configurable and swappable. Bring your own LLM, TTS engine, etc.
4. **Perception capabilities**: Raven model can see and interpret the user's facial expressions, body language, and screen content.
5. **Developer-friendly**: Well-documented API, React components, WebRTC-based (standard protocol), multiple integration paths.
6. **Enterprise-grade**: SOC 2, GDPR, HIPAA, BAA compliance. Conversation recording, private rooms, auth tokens.
7. **30+ language support**: Broad international capability.
8. **LLM flexibility**: Supports custom LLMs, tool calling, RAG, and even voice-to-voice models where Tavus only drives the visual rendering.

### Limitations

1. **Cost at scale**: At $0.32-$0.37/min for CVI, high-volume deployments become expensive quickly. A 24/7 agent costs ~$14,000-$16,000/month in CVI minutes alone.
2. **WebRTC dependency**: Currently tied to Daily as the WebRTC transport provider. All conversations require WebRTC infrastructure.
3. **Custom replica training**: Requires video footage and processing time. Limited trainings per month on lower tiers. Only Business/Enterprise can create custom replicas of real people.
4. **Rendering quality**: While good, Phoenix still has challenges with "in-the-wild" training videos. Quality depends on training data.
5. **No offline/edge deployment**: The full pipeline runs in Tavus's cloud. No option for local/edge inference for latency-sensitive or privacy-sensitive deployments beyond what the Enterprise tier offers.
6. **Concurrency limits**: Free/Starter tiers are severely limited (3 concurrent streams max at Starter). Growth allows 15.
7. **Proprietary lock-in**: While individual layers are swappable, the core rendering (Phoenix) and perception (Raven) models are proprietary and closed. You cannot self-host the video rendering.
8. **Limited avatar customization**: Avatars are trained from real human footage. You cannot create fictional/stylized characters from scratch -- the replica must be based on a real person's video.

---

## 7. Key Takeaways

### For Building Something Similar

1. **The hard problem is real-time rendering, not LLM integration.** Tavus's moat is Phoenix -- the gaussian-diffusion model that renders faces at 60+ FPS with sub-500ms latency. The LLM layer is comparatively commoditized (they support multiple providers).

2. **The CVI pipeline is a seven-layer stack.** Building a similar system requires: WebRTC transport, speech recognition, turn-taking/dialogue management, LLM integration, text-to-speech, and real-time avatar rendering. Each layer introduces latency that must be minimized.

3. **3D Gaussian Splatting (3DGS) is the current state-of-the-art for real-time face rendering.** Phoenix evolved from NeRF to 3DGS for explicit scene representation, faster training (70% reduction), and real-time rendering (60+ FPS). This is the technique to study for building a custom renderer.

4. **Latency budget is ~1 second end-to-end.** This must cover: audio capture, STT, LLM inference, TTS, and video rendering. Each component must be optimized -- there is no room for slow API calls.

5. **Perception (understanding the user) is a significant differentiator.** Raven reads facial expressions and body language. This makes conversations feel more natural but adds complexity and compute requirements.

6. **Turn-taking is critical for natural conversation.** Sparrow's ability to detect when the user is done speaking (semantic + lexical detection) and manage interruptions is what prevents awkward pauses or talking over each other.

7. **WebRTC is the standard transport.** Tavus uses Daily for WebRTC. Any real-time video system will need WebRTC infrastructure for low-latency audio/video streaming.

8. **Cost structure:** At current Tavus pricing, a single concurrent agent running 8 hours/day costs ~$4,600-$5,300/month. Building custom infrastructure only makes economic sense at significant scale or when you need capabilities Tavus does not offer.

### Competitive Landscape

| Platform | Focus | Real-Time Interactive | Latency |
|----------|-------|-----------------------|---------|
| **Tavus** | Real-time conversational video AI | Yes (core product) | < 1 sec |
| **HeyGen** | Pre-rendered video generation from scripts | Limited (Streaming Avatar) | Higher |
| **Synthesia** | Script-to-video with 140+ avatars | No (pre-rendered) | N/A |
| **D-ID** | AI avatar generation and animation | Limited | Higher |
| **a2e.ai** | Avatar API for real-time interaction | Yes | Varies |

Tavus is the clear leader in **real-time interactive** conversational video. Competitors like HeyGen and Synthesia focus on pre-rendered video content creation, which is a different use case entirely.

---

## Sources

- [Tavus Documentation](https://docs.tavus.io/sections/introduction)
- [Tavus CVI Overview](https://docs.tavus.io/sections/conversational-video-interface/overview-cvi)
- [Tavus Product Site](https://www.tavus.io/)
- [Tavus Pricing](https://www.tavus.io/pricing)
- [Tavus Phoenix Model](https://www.tavus.io/model/phoenix)
- [Phoenix-2: 3D Gaussian Splatting](https://www.tavus.io/post/advanced-techniques-in-talking-head-generation-3d-gaussian-splatting)
- [Meta AI Blog: Tavus + Llama](https://ai.meta.com/blog/tavus-real-feeling-ai-videos-llama/)
- [Tavus API Reference](https://docs.tavus.io/llms.txt)
- [Tavus GitHub](https://github.com/Tavus-Engineering)
- [Cerebras + Tavus Digital Twin](https://www.cerebras.ai/blog/building-real-time-digital-twin-with-cerebras-at-tavus)
- [Tavus CVI Introduction](https://www.tavus.io/post/conversational-video-interface-cvi-bridge-between)
- [Phoenix-3 / Raven-0 / Sparrow-0 Announcement](https://www.businesswire.com/news/home/20250306296766/en/)
