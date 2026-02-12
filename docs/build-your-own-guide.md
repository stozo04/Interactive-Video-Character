# Build Your Own Talking Head Video Model: A Practical Guide

> **Last Updated:** February 2026
> **Audience:** Solo developer building an interactive AI character with real-time video conversations

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Open-Source Model Comparison & Rankings](#open-source-model-comparison--rankings)
3. [Training Your Own Model](#training-your-own-model)
4. [End-to-End Architecture Design](#end-to-end-architecture-design)
5. [Pre-Built Frameworks (Fastest Path)](#pre-built-frameworks-fastest-path)
6. [Feasibility Assessment](#feasibility-assessment)
7. [Recommended Approach](#recommended-approach)

---

## Executive Summary

Building a real-time interactive AI video character involves chaining together five components: **Speech-to-Text (STT) -> LLM -> Text-to-Speech (TTS) -> Talking Head Video Generation -> Streaming to User**. The good news: every piece of this pipeline now has viable open-source options. The bad news: stitching them together with sub-1-second latency is the hard engineering problem.

**Bottom line for a solo developer:** You do NOT need to train a model from scratch. Start with a pre-built framework like **Linly-Talker** or **OpenAvatarChat**, swap in your preferred components, and iterate. Training a person-specific model (like GeneFace++) is a worthwhile optimization later, not a prerequisite.

---

## Open-Source Model Comparison & Rankings

### Tier 1: Best Starting Points for DIY Real-Time Projects

| Model | Type | Real-Time? | Min GPU | Quality | Ease of Setup | Best For |
|-------|------|-----------|---------|---------|--------------|----------|
| **MuseTalk** | Lip-sync inpainting | Yes (30+ FPS on V100) | 6GB VRAM | Good lip sync | Medium | Real-time conversations |
| **LivePortrait** | Portrait animation | Yes (30+ FPS w/ TensorRT) | 6-8GB VRAM | High fidelity | Medium | Expressive animation |
| **GeneFace++** | NeRF-based, person-specific | Yes (45 FPS on 3090) | 8GB VRAM | Excellent (person-specific) | Hard | Best quality for YOUR face |

### Tier 2: High Quality, Not Real-Time (Good for Pre-Rendering)

| Model | Type | Real-Time? | Min GPU | Quality | Ease of Setup | Best For |
|-------|------|-----------|---------|---------|--------------|----------|
| **Hallo2** | Diffusion-based | No (slow inference) | 24GB+ VRAM | Excellent, 4K | Hard | High-quality pre-rendered video |
| **EchoMimic V2** | Diffusion + landmarks | No | 12-24GB VRAM | Excellent, half-body | Medium | Semi-body animation |
| **SadTalker** | 3DMM coefficients | Borderline | 4-6GB VRAM | Good | Easy | Quick prototyping, low GPU |

### Tier 3: Legacy / Specialized

| Model | Type | Real-Time? | Min GPU | Quality | Notes |
|-------|------|-----------|---------|---------|-------|
| **Wav2Lip** | Lip-sync overlay | Yes | 4GB VRAM | Moderate (blurry lips) | Pioneer model, showing age |
| **NVIDIA Audio2Face** | 3D facial animation | Yes | Varies | N/A (3D mesh output) | MIT licensed, for 3D avatars only |

### Detailed Model Notes

#### MuseTalk (Recommended Starting Point)
- **GitHub:** https://github.com/TMElyralab/MuseTalk
- **What it does:** Real-time lip-sync inpainting. Takes a face image/video + audio and produces synced lip movements.
- **Speed:** 30+ FPS on V100, real-time on RTX 3090/4090
- **Setup:** Python >= 3.10, CUDA 11.7+
- **Key advantage:** Only the UNet and VAE decoder run during inference, making it lightweight for real-time use
- **Training your own:** Community fork at https://github.com/luxiaolili/MuseTalk_train
- **Version:** MuseTalk 1.5 (March 2025) with improved quality, same inference speed

#### LivePortrait + FasterLivePortrait
- **GitHub:** https://github.com/KlingTeam/LivePortrait
- **Accelerated version:** https://github.com/warmshao/FasterLivePortrait
- **What it does:** Portrait animation with eye gaze control, lip movement, emotion expression
- **Speed:** 30+ FPS on RTX 3090 with TensorRT (FasterLivePortrait), ~12 FPS with ONNX
- **Two-stage training:**
  1. Base model (appearance/motion extractors, warping, decoder)
  2. Stitching/retargeting modules (freeze base, train control)
- **Key advantage:** Precise eye gaze and lip control, handles multiple face orientations

#### GeneFace++ (Best Quality for Person-Specific)
- **GitHub:** https://github.com/yerfor/GeneFacePlusPlus
- **What it does:** Person-specific NeRF talking face. Train on YOUR face video, get photorealistic results.
- **Training data:** A few minutes of video of yourself talking
- **Training time:** ~12 hours on a single RTX 3090
- **Inference speed:** 45 FPS on RTX 3090, 60 FPS on A100 (512x512)
- **Key advantage:** Best identity preservation and realism for a specific person
- **Key disadvantage:** Must train per person, not generalizable

#### Hallo2 (Highest Quality, Not Real-Time)
- **GitHub:** https://github.com/fudan-generative-vision/hallo2
- **What it does:** Diffusion-based, supports 4K resolution, up to 1-hour duration
- **Requirements:** Requires Stable Diffusion V1.5, AnimateDiff, InsightFace, MediaPipe
- **Key advantage:** Stunning quality, 4K output
- **Key disadvantage:** Far too slow for real-time; useful for pre-rendered content

#### EchoMimic V2 (Half-Body with Gestures)
- **GitHub:** https://github.com/antgroup/echomimic_v2
- **What it does:** Audio-driven half-body animation with hand gestures
- **GPU:** A100 (80G) / RTX 4090 (24G) / V100 (16G), quantized version for 12GB
- **Key advantage:** Includes hand/body gestures, not just face
- **Key disadvantage:** Not real-time, diffusion-based
- **Note:** EchoMimic V3 (AAAI 2026) unifies multi-modal animation in 1.3B params

#### SadTalker (Easiest to Start)
- **GitHub:** https://github.com/OpenTalker/SadTalker
- **What it does:** One-shot audio-driven talking head from a single image
- **Setup:** Simplest of all models. Clone, install, run.
- **Command:** `python inference.py --driven_audio audio.wav --source_image face.png --enhancer gfpgan`
- **Key advantage:** Dead simple, works with any face image
- **Key disadvantage:** Lower quality than newer models, not truly real-time

---

## Training Your Own Model

### When to Train vs. Use Pre-Trained

| Approach | When to Use | Data Needed | Time to Results |
|----------|-------------|-------------|-----------------|
| **Pre-trained (one-shot)** | Prototyping, testing pipeline | 1 photo | Minutes |
| **Fine-tuned** | Better quality for your face | 2-5 min video | Hours |
| **Person-specific (GeneFace++)** | Production quality | 5-10 min video | 12-24 hours |
| **Trained from scratch** | Research only | 100+ hours video | Weeks |

### Data Collection Requirements

For fine-tuning or person-specific training:

**Video Recording Best Practices:**
- **Duration:** 3-10 minutes of you talking (more is better, diminishing returns after 10 min)
- **Resolution:** 1080p minimum, 4K preferred
- **Framing:** Head and shoulders, face occupying significant portion of frame
- **Lighting:** Even, well-lit, avoid harsh shadows
- **Background:** Plain/simple, consistent
- **Content:** Natural speech covering diverse phonemes and expressions
- **Head poses:** Include slight head movements, don't stay perfectly still
- **Eye gaze:** Natural variations in gaze direction
- **Format:** MP4/AVI, 25-30 FPS
- **Audio:** Clear, low noise, use a lapel or desk mic

**What to Say During Recording:**
- Read diverse text (news articles, stories) to cover all phonemes
- Include emotional variation (happy, serious, surprised)
- Include pauses and natural speech patterns
- Avoid exaggerated expressions unless you want the model to replicate them

### Training Pipeline: GeneFace++ (Recommended for Person-Specific)

```bash
# 1. Clone the repository
git clone https://github.com/yerfor/GeneFacePlusPlus.git
cd GeneFacePlusPlus

# 2. Set up environment
conda create -n geneface python=3.10
conda activate geneface
pip install -r requirements.txt

# 3. Prepare your video data
# Place your video in data/raw/YOUR_NAME/
# The video should be of you talking, 3-10 minutes

# 4. Preprocess (extracts face, landmarks, audio features)
python data_gen/process_video.py --video_path data/raw/YOUR_NAME/video.mp4

# 5. Train the audio-to-motion model (~40k steps, ~6 hours)
python tasks/run.py --config configs/motion/lm3d_vae.yaml

# 6. Train the motion-to-video model (NeRF, ~10k steps, ~6 hours)
python tasks/run.py --config configs/postnet/lm3d_postnet.yaml

# 7. Inference
python inference/genefacepp_infer.py \
    --audio_path test_audio.wav \
    --head_ckpt checkpoints/motion/YOUR_NAME \
    --torso_ckpt checkpoints/postnet/YOUR_NAME
```

**Training hardware:** Single RTX 3090 (24GB VRAM)
**Training time:** ~12 hours total
**Inference speed:** 45 FPS (512x512) on RTX 3090

### Cloud GPU Cost Estimates for Training

| Provider | GPU | Price/hr | 12hr Training Cost |
|----------|-----|----------|-------------------|
| **RunPod** | RTX 4090 (24GB) | $0.34/hr (community) | ~$4 |
| **RunPod** | A100 80GB | $1.74/hr | ~$21 |
| **Lambda Labs** | H100 SXM | $2.99/hr | ~$36 |
| **AWS** | p4d.24xlarge (A100) | ~$32/hr | ~$384 |
| **Vast.ai** | RTX 3090 | ~$0.20/hr | ~$2.40 |

**Recommendation:** Use RunPod community cloud or Vast.ai for personal training. An RTX 4090 at ~$0.34/hr is the sweet spot. Total cost for GeneFace++ training: **under $5**.

---

## End-to-End Architecture Design

### The Full Pipeline

```
User Speaks
    |
    v
[Microphone] --> [VAD] --> [STT] --> [LLM] --> [TTS] --> [Video Gen] --> [Stream]
                  ~50ms     ~200ms    ~500ms    ~200ms     ~33ms          ~50ms

Total Target: < 1.5 seconds end-to-end
```

### Component Selection

#### Speech-to-Text (STT)

| Option | Latency | Cost | Streaming? | Recommendation |
|--------|---------|------|-----------|----------------|
| **Deepgram Nova-3** | < 300ms | $4.30/1K min | Yes (native) | Best for real-time |
| **AssemblyAI Universal-2** | ~300ms | $6.50/1K min | Yes | Good alternative |
| **Whisper (local)** | 1-3s | Free | No (needs chunking) | Not recommended for real-time |
| **Whisper (OpenAI API)** | 500ms-1s | $6/1K min | Via Realtime API | OK if using OpenAI ecosystem |
| **OmniSenseVoice** | Fast | Free (local) | Yes | Used in Linly-Talker |

**Winner for real-time:** Deepgram Nova-3. Sub-300ms, native streaming, lowest error rate.
**Winner for local/free:** OmniSenseVoice or Faster-Whisper with chunking.

#### LLM (Language Model)

| Option | Latency (TTFT) | Cost | Local? | Notes |
|--------|----------------|------|--------|-------|
| **GPT-4o / Claude** | 300-800ms | API pricing | No | Best quality, highest latency |
| **GPT-4o-mini** | 200-400ms | Cheap | No | Good balance |
| **Llama 3 8B (local)** | 100-300ms | Free | Yes | Requires 16GB+ VRAM |
| **Mistral 7B (local)** | 100-300ms | Free | Yes | Good quality/speed ratio |
| **MiniCPM-o** | ~200ms | Free | Yes | Multimodal, used in OpenAvatarChat |

**For lowest latency:** Local Llama 3 8B with vLLM or llama.cpp
**For best quality:** GPT-4o-mini (streaming, first token in ~200ms)
**Optimization:** Use speculative decoding or start generating during STT streaming

#### Text-to-Speech (TTS)

| Option | Latency (TTFB) | Quality | Streaming? | Voice Clone? | Cost |
|--------|----------------|---------|-----------|-------------|------|
| **XTTS v2** | ~200ms | Very Good | Yes | Yes (few-shot) | Free (local) |
| **Kokoro-82M** | < 100ms | Near-ElevenLabs | Limited | No | Free (local) |
| **ElevenLabs Flash** | < 100ms | Excellent | Yes | Yes | $22-99/mo |
| **F5-TTS** | Higher | Excellent | No (non-AR) | Yes | Free (local) |
| **CosyVoice** | ~200ms | Good | Yes | Yes | Free (local) |
| **Edge TTS** | ~100ms | Good | Yes | No (preset voices) | Free |

**Winner for real-time + voice clone:** XTTS v2 (local) or ElevenLabs Flash (API)
**Winner for speed:** Kokoro-82M (96x real-time on GPU, but no voice cloning)
**Winner for quality:** F5-TTS (but not streamable, so not for real-time)

**Key insight:** XTTS v2 is the best local option for real-time with voice cloning. Kokoro is faster but cannot clone your voice. For production, ElevenLabs Flash gives the best latency + quality + cloning combination.

#### Video Generation (Talking Head)

| Option | FPS | Latency | GPU | Quality | Notes |
|--------|-----|---------|-----|---------|-------|
| **MuseTalk** | 30+ | ~33ms/frame | V100/3090 | Good | Best for real-time lip sync |
| **FasterLivePortrait** | 30+ | ~33ms/frame | 3090 (TensorRT) | High | Best for expressive animation |
| **GeneFace++** | 45-60 | ~16-22ms/frame | 3090/A100 | Excellent | Best quality, person-specific |
| **Wav2Lip** | 25+ | ~40ms/frame | 4GB | Moderate | Simple, fast, lower quality |

**Winner for real-time:** MuseTalk (easiest) or GeneFace++ (best quality, needs training)

#### Streaming to User

| Protocol | Latency | Complexity | Notes |
|----------|---------|-----------|-------|
| **WebRTC** | < 500ms | High | Industry standard, P2P, best for real-time |
| **WebSocket + Canvas** | 100-300ms | Medium | Simpler, send frames as images |
| **HLS/DASH** | 2-10s | Low | Not suitable for interactive |

**Winner:** WebRTC for production. WebSocket + HTML5 Canvas for prototyping.

### Optimizing End-to-End Latency

**Key strategies:**

1. **Pipeline parallelism:** Start TTS while LLM is still generating (stream tokens to TTS)
2. **Speculative execution:** Begin video generation on partial TTS output
3. **Audio chunking:** Send TTS audio in small chunks (100-200ms) to video model
4. **VAD (Voice Activity Detection):** Detect end of speech early to trigger pipeline sooner
5. **Pre-rendered idle animation:** Show blinking/breathing while processing
6. **Warm caching:** Keep models loaded in GPU memory, avoid cold starts

**Realistic latency budget:**
```
VAD detection:           50ms
STT (streaming):        200ms  (overlaps with speech)
LLM (first token):     300ms
TTS (first chunk):     200ms
Video gen (first frame): 33ms
WebRTC delivery:         50ms
---
Total perceived delay: ~800ms - 1.5s from end of user speech
```

This is achievable on a single high-end GPU (RTX 4090) or split across 2 GPUs.

---

## Pre-Built Frameworks (Fastest Path)

These projects combine all components into a working system. Start here.

### 1. Linly-Talker (Most Complete, Recommended)
- **GitHub:** https://github.com/Kedreamix/Linly-Talker
- **Stars:** 5000+
- **What it is:** Complete digital avatar conversational system
- **Components:**
  - STT: Whisper / OmniSenseVoice
  - LLM: Multiple options (Linly, ChatGPT, Gemini, local models)
  - TTS: Edge TTS, CosyVoice, XTTS
  - Video: SadTalker, Wav2Lip, MuseTalk (real-time)
  - UI: Gradio WebUI
- **Key feature:** MuseTalk integration for near-real-time conversations
- **Setup complexity:** Medium (Docker available)
- **GPU needed:** 8GB+ VRAM (16GB+ recommended for MuseTalk mode)

### 2. OpenAvatarChat (Modular, Modern)
- **GitHub:** https://github.com/HumanAIGC-Engineering/OpenAvatarChat
- **What it is:** Modular interactive digital human dialogue system
- **Components:**
  - Multimodal: MiniCPM-o (replaces ASR+LLM+TTS) or API-based
  - Avatar: LiteAvatar (2D) or LAM (3D Gaussian Splatting)
  - UI: WebGL-based
- **Key feature:** Can run entirely on a single PC
- **Performance:** ~2.2s average response delay on i9-13900KF + RTX 4090
- **Setup complexity:** Medium

### 3. AIAvatarKit (Lightweight Python Framework)
- **GitHub:** https://github.com/uezo/aiavatarkit
- **Install:** `pip install aiavatar`
- **What it is:** General-purpose Speech-to-Speech framework
- **Components:** Modular VAD, STT, LLM, TTS
- **Key features:**
  - Ultra-low latency via WebSocket/HTTP
  - VRChat/metaverse platform compatible
  - Runs on edge devices (Raspberry Pi!)
  - Built-in conversation evaluation framework
- **Setup complexity:** Easy
- **Best for:** Quick prototyping with 3D avatars

### 4. Duix-Avatar (Offline Clone Your Face)
- **GitHub:** https://github.com/duixcom/Duix-Avatar
- **What it is:** Fully offline video synthesis for face cloning
- **Key feature:** Clone your appearance AND voice, fully offline on Windows
- **Setup:** Docker-based, Windows or Ubuntu 22.04
- **Best for:** Creating pre-rendered videos of yourself

### 5. LiveAvatar (Alibaba - Cutting Edge, Heavy)
- **GitHub:** https://github.com/Alibaba-Quark/LiveAvatar
- **What it is:** 14B parameter diffusion model for streaming avatar generation
- **Performance:** 20 FPS on 5x H800 GPUs, or FP8 on 48GB GPUs
- **Key feature:** 10,000+ second continuous streaming, highest visual quality
- **Key limitation:** Requires multi-GPU setup (5x H800 for full speed)
- **Best for:** Enterprise-grade, not solo developer friendly

### 6. Talking Avatar with AI (Simplest Complete Example)
- **GitHub:** https://github.com/asanchezyali/talking-avatar-with-ai
- **What it is:** Digital human using GPT + Whisper + ElevenLabs + Rhubarb Lip Sync
- **Setup complexity:** Easy
- **Best for:** Understanding the full pipeline as a learning exercise

---

## Feasibility Assessment

### What a Solo Developer Can Realistically Achieve

| Goal | Difficulty | Timeline | Hardware |
|------|-----------|----------|----------|
| Get a basic demo working with pre-built framework | Easy | 1-2 days | Any GPU 8GB+ |
| Swap components (better TTS, your face photo) | Easy | 1 week | Any GPU 8GB+ |
| Real-time conversation with acceptable quality | Medium | 2-4 weeks | RTX 3090/4090 |
| Train person-specific model (GeneFace++) | Medium | 1-2 weeks | RTX 3090+ or cloud GPU |
| Production-quality real-time system | Hard | 2-3 months | RTX 4090 or dual GPU |
| Match Tavus/HeyGen quality | Very Hard | 6+ months | Multi-GPU, significant engineering |

### What Requires a Team vs. Solo

**Solo-Friendly:**
- Setting up Linly-Talker or OpenAvatarChat
- Fine-tuning a person-specific model
- Building a WebSocket-based streaming pipeline
- Integrating STT + LLM + TTS
- Deploying on a single GPU server

**Needs a Team (or Significant Time):**
- Training a model from scratch
- Building a production WebRTC infrastructure
- Multi-GPU distributed inference (like LiveAvatar)
- Mobile/edge deployment optimization
- Handling concurrent users at scale

### Biggest Technical Challenges

1. **Latency stacking:** Each component adds delay. Getting total < 1.5s requires careful optimization at every stage.
2. **GPU memory contention:** Running STT + LLM + TTS + Video Gen on one GPU requires careful memory management. Quantization and model offloading are essential.
3. **Audio-visual sync:** The video must match the audio precisely. Small timing errors are very noticeable.
4. **Temporal consistency:** Frame-to-frame jitter and artifacts are common in real-time generation.
5. **Identity preservation:** Models may drift from your appearance, especially with extreme expressions.
6. **Streaming architecture:** Getting frames to the user with minimal additional latency requires WebRTC or similar low-latency protocol.

### Hardware Recommendations

**Minimum Viable (Prototyping):**
- RTX 3060 12GB or RTX 4060 8GB
- Can run: SadTalker, Wav2Lip, basic pipeline
- Cannot do: Real-time MuseTalk or GeneFace++

**Recommended (Real-Time Capable):**
- RTX 4090 24GB
- Can run: Full pipeline (STT + small LLM + TTS + MuseTalk) on single GPU
- Sweet spot for solo developer

**Ideal (Comfortable Headroom):**
- 2x RTX 4090 or 1x A100 80GB
- Can run: GeneFace++ at 60 FPS + larger LLM + higher quality TTS
- Room for experimentation

**Cloud Alternative:**
- RunPod: RTX 4090 at $0.34/hr, A100 at $1.74/hr
- Vast.ai: RTX 3090 at ~$0.20/hr
- Use for training, run inference locally or on persistent cloud instance

---

## Recommended Approach

### Phase 1: Proof of Concept (Week 1)

**Goal:** Get a working end-to-end demo

1. **Clone Linly-Talker:**
   ```bash
   git clone https://github.com/Kedreamix/Linly-Talker.git
   cd Linly-Talker
   # Follow their Docker or conda setup instructions
   ```

2. **Use the default configuration:**
   - STT: Whisper (built-in)
   - LLM: ChatGPT API (easiest start)
   - TTS: Edge TTS (free, fast)
   - Video: SadTalker (simplest)

3. **Test with your face photo** as the source image

4. **Upgrade to MuseTalk mode** for near-real-time:
   - Follow Linly-Talker's MuseTalk integration docs
   - Record a short video of yourself for the MuseTalk reference

### Phase 2: Quality Improvement (Weeks 2-3)

**Goal:** Better voice, better face, lower latency

1. **Upgrade TTS to XTTS v2** for voice cloning:
   ```bash
   pip install TTS
   # Record 30 seconds of your voice as reference
   # Configure Linly-Talker to use XTTS
   ```

2. **Train GeneFace++ on your face** (optional but recommended):
   ```bash
   # Record 5-10 min video of yourself talking
   # Upload to RunPod, train for ~12 hours ($4-5)
   # Download trained checkpoint
   ```

3. **Replace STT with Deepgram** for streaming (if budget allows):
   - Sign up for Deepgram (free tier: 45,000 minutes)
   - Swap Whisper for Deepgram streaming API

4. **Optimize LLM:**
   - Use GPT-4o-mini with streaming for low TTFT
   - Or run local Llama 3 8B with llama.cpp if you have VRAM headroom

### Phase 3: Real-Time Pipeline (Weeks 3-6)

**Goal:** Sub-1.5s response time, smooth streaming

1. **Build custom pipeline** (Python):
   - VAD: Silero VAD (local, ~50ms)
   - STT: Deepgram streaming
   - LLM: Streaming API with first-token callback
   - TTS: XTTS v2 with chunk-based streaming
   - Video: MuseTalk or GeneFace++ inference loop
   - Streaming: WebSocket initially, WebRTC later

2. **Implement pipeline parallelism:**
   - Start TTS as soon as first LLM tokens arrive
   - Start video generation as soon as first TTS audio chunk is ready
   - Stream video frames to client as they are generated

3. **Add idle animation:**
   - Pre-render a few seconds of idle (blinking, slight movement)
   - Loop during processing to avoid frozen frame

### Phase 4: Production Polish (Months 2-3)

**Goal:** Deployable, reliable system

1. **WebRTC streaming** for lowest latency delivery
2. **Error handling** for dropped connections, model failures
3. **Memory optimization** to fit everything on one GPU
4. **Monitoring** for latency tracking per pipeline stage
5. **Optional:** Deploy on cloud GPU (RunPod serverless or persistent)

---

## Key GitHub Repositories Reference

| Repository | Description | Stars |
|-----------|-------------|-------|
| [Linly-Talker](https://github.com/Kedreamix/Linly-Talker) | Complete digital human dialogue system | 5000+ |
| [OpenAvatarChat](https://github.com/HumanAIGC-Engineering/OpenAvatarChat) | Modular interactive avatar SDK | New |
| [MuseTalk](https://github.com/TMElyralab/MuseTalk) | Real-time lip sync | 3000+ |
| [LivePortrait](https://github.com/KlingTeam/LivePortrait) | Portrait animation | 10000+ |
| [FasterLivePortrait](https://github.com/warmshao/FasterLivePortrait) | TensorRT-accelerated LivePortrait | 2000+ |
| [GeneFace++](https://github.com/yerfor/GeneFacePlusPlus) | Person-specific NeRF talking face | 1000+ |
| [SadTalker](https://github.com/OpenTalker/SadTalker) | One-shot talking head from image | 15000+ |
| [Hallo2](https://github.com/fudan-generative-vision/hallo2) | High-res diffusion talking head | 3000+ |
| [EchoMimic V2](https://github.com/antgroup/echomimic_v2) | Semi-body animation | 2000+ |
| [AIAvatarKit](https://github.com/uezo/aiavatarkit) | Python avatar framework | 500+ |
| [Duix-Avatar](https://github.com/duixcom/Duix-Avatar) | Offline face cloning toolkit | 2000+ |
| [LiveAvatar](https://github.com/Alibaba-Quark/LiveAvatar) | Alibaba's streaming avatar | 1000+ |
| [NVIDIA Audio2Face](https://github.com/NVIDIA/Audio2Face-3D) | Open-source 3D facial animation | New |
| [LAM](https://github.com/aigc3d/LAM) | Large Avatar Model (3DGS) | New |
| [Awesome Talking Head Synthesis](https://github.com/Kedreamix/Awesome-Talking-Head-Synthesis) | Paper/repo collection | 3000+ |

---

## Cost Summary

### Minimum Viable Setup (Using Existing Hardware)

| Item | Cost |
|------|------|
| Open-source models | $0 |
| ChatGPT API (prototyping) | ~$5/month |
| Edge TTS | $0 |
| Deepgram STT (free tier) | $0 |
| **Total** | **~$5/month** |

### Recommended Setup (Best Quality)

| Item | Cost |
|------|------|
| Cloud GPU training (GeneFace++, one-time) | $5-20 |
| RTX 4090 (if buying) | $1,600-2,000 |
| OR RunPod persistent (RTX 4090) | ~$250/month |
| Deepgram STT | $4.30/1K min |
| ElevenLabs TTS (optional) | $22-99/month |
| LLM API (GPT-4o-mini) | ~$10-30/month |
| **Total (cloud)** | **~$300-400/month** |
| **Total (own GPU)** | **~$40-130/month + GPU purchase** |

---

## Emerging Models to Watch (2025-2026)

- **EchoMimic V3** (AAAI 2026): Unified multi-modal, multi-task in 1.3B params
- **A2-LLM:** End-to-end conversational audio avatar LLM (joint language + audio + 3D facial motion)
- **TalkingMachines:** FaceTime-style video via autoregressive diffusion
- **PGSTalker:** Real-time 3D Gaussian Splatting talking face with pixel-aware density control
- **LAM (Large Avatar Model):** One-shot animatable Gaussian head (SIGGRAPH 2025)
- **JoyAvatar:** Real-time infinite audio-driven avatar with autoregressive diffusion

The field is moving fast. Check [Awesome Talking Head Synthesis](https://github.com/Kedreamix/Awesome-Talking-Head-Synthesis) and [talking-face-arxiv-daily](https://github.com/liutaocode/talking-face-arxiv-daily) for weekly updates.
