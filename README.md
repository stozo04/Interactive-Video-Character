# AI Interactive Chat

<div align="center">
  <h3>Your Personalized AI Companion with Memory, Personality, and Real-World Awareness</h3>
  <p>A powerful wrapper around any LLM that creates a consistent, customizable AI personality that remembers everything, manages your life, and grows with you over time.</p>

  ![React](https://img.shields.io/badge/React-19-blue)
  ![TypeScript](https://img.shields.io/badge/TypeScript-5-blue)
  ![Vite](https://img.shields.io/badge/Vite-6-purple)
  ![Supabase](https://img.shields.io/badge/Supabase-Cloud-green)
  ![License](https://img.shields.io/badge/License-MIT-green)
</div>

## Preview

<div align="center">
  <p><em>Screenshot coming soon</em></p>
</div>

---

## Features

- **Customizable Personality** - Define your AI's character through a simple profile file. Control personality traits, communication style, interests, and backstory to create a consistent companion that feels authentically *yours*.

- **Never-Ending Memory** - All conversations and facts are stored in a cloud database. Your AI remembers every detail about your life and its own experiences as your relationship grows over time.

- **Task Management** - Create and track daily tasks to stay on top of your checklist. Your AI helps you stay accountable and on track.

- **Gmail & Calendar Integration** - View calendar events, add/edit/remove appointments, and stay on top of your schedule through natural conversation.

- **Autonomous Selfies** - Your AI knows when to send selfies based on context and mood, with consistent character appearance powered by AI image generation.

- **Dynamic Video Responses** - Generate videos based on moods, events, and conversation context with consistent character representation.

- **Promise Tracking** - Your AI can make promises and commitments, then remember to follow through on them later.

- **Real-World Awareness** - Time-aware, location-aware, and news-aware. Your AI can search the web and understands what's happening in your world right now.

- **Multi-Provider Support** - Choose from Google Gemini, OpenAI GPT, or xAI Grok as your AI backend.

---

## Supported Providers

### Google Gemini
- **API Key**: Get from [Google AI Studio](https://aistudio.google.com/app/apikey)
- **Models**: Gemini 3.0 Flash, Gemini 2.5 Flash TTS, Gemini 3 Pro Image
- **Features**: High-quality vision models, text-to-speech, image generation, cost-effective

### xAI Grok
- **API Key**: Get from [xAI API](https://x.ai/api)
- **Models**: grok-4-fast-reasoning, grok-imagine-image
- **Features**: Fast reasoning, high-quality image generation

### OpenAI
- **API Key**: Get from [OpenAI Platform](https://platform.openai.com/api-keys)
- **Models**: GPT-5 Nano, GPT-4o
- **Features**: Industry-leading performance, vector store for memory

---

## Quick Start

### Prerequisites

- Node.js 18+
- A Supabase project ([create one free](https://supabase.com))
- At least one AI provider API key (Gemini, OpenAI, or Grok)
- Google OAuth credentials (for authentication & Gmail)

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/yourusername/ai-interactive-chat.git
   cd ai-interactive-chat
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   ```bash
   cp .env.example .env.local
   ```

   Edit `.env.local` with your API keys (see [Environment Variables](#environment-variables) below).

4. **Apply database migrations**

   Run the SQL files in `supabase/migrations/` against your Supabase project.

5. **Run the development server**
   ```bash
   npm run dev
   ```

6. **Open your browser**

   Navigate to [http://localhost:3000](http://localhost:3000)

---

## Customizing Your AI Character

The magic of this system is the fully customizable personality. Edit the character profile to create your perfect AI companion:

```
docs/features/Kayley_Adams_Character_Profile.md
```

This profile defines:
- **Basic Info** - Name, age, location, background
- **Personality Traits** - Core characteristics and behaviors
- **Communication Style** - How your AI speaks and expresses itself
- **Interests & Opinions** - What your AI cares about
- **Backstory** - History that shapes their perspective

The included "Kayley Adams" profile is a fully fleshed-out example you can use directly or customize to your preferences.

---

## Tech Stack

| Category | Technology |
|----------|------------|
| **Framework** | [React 19](https://react.dev/) + [Vite 6](https://vite.dev/) |
| **Language** | [TypeScript 5](https://www.typescriptlang.org/) |
| **Database** | [Supabase](https://supabase.com/) (PostgreSQL + Auth) |
| **AI Providers** | Google Gemini, OpenAI, xAI Grok |
| **Styling** | Tailwind CSS |
| **Testing** | Vitest (550+ tests) |

---

## Project Structure

```
ai-interactive-chat/
├── src/
│   ├── components/          # React UI components
│   ├── services/            # Business logic & AI providers
│   │   ├── system_prompts/  # Modular prompt architecture
│   │   └── docs/            # Service documentation
│   ├── contexts/            # React Context (auth, AI selection)
│   ├── hooks/               # Custom React hooks
│   └── domain/              # Domain models
├── docs/
│   ├── features/            # Feature documentation
│   └── plans/               # Implementation plans
├── supabase/
│   └── migrations/          # Database schema
└── .claude/
    └── agents/              # Claude Code sub-agents
```

---

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `VITE_GEMINI_API_KEY` | Google Gemini API key | Optional* |
| `VITE_CHATGPT_API_KEY` | OpenAI API key | Optional* |
| `VITE_GROK_API_KEY` | xAI Grok API key | Optional* |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | Yes |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key | Yes |
| `VITE_GOOGLE_CLIENT_ID` | Google OAuth client ID | Yes |
| `VITE_USER_ID` | Your user identifier | Yes |

\* At least one AI provider must be configured

See `.env.example` for the complete list of available configuration options.

---

## Documentation

| Document | Description |
|----------|-------------|
| [Character Profile](docs/features/Kayley_Adams_Character_Profile.md) | Example AI personality configuration |
| [Google OAuth Setup](docs/GOOGLE_OAUTH_SETUP.md) | Authentication configuration guide |
| [System Prompt Guidelines](docs/System_Prompt_Guidelines.md) | How to modify AI behavior |
| [CLAUDE.md](CLAUDE.md) | Developer guide for Claude Code |

---

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

---

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## Support

If you encounter any issues or have questions:
- Open an [issue](https://github.com/yourusername/ai-interactive-chat/issues)
- Star this repository if you find it helpful!

---

<div align="center">
  <p>Built with the belief that AI companions should remember, grow, and feel authentically yours.</p>
</div>
