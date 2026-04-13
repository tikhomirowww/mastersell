# AI Manager

**AI-powered sales agent for small and medium businesses.**  
Handles customer calls, WhatsApp, and Instagram — so you don't have to.

---

## What it does

AI Manager is a SaaS platform that gives any business an intelligent sales assistant that works 24/7 across every channel a customer might reach out on.

You describe your business in plain language — what you sell, your prices, your conditions — and the agent starts talking to your customers as if it's been on your team for years. It qualifies leads, answers questions, handles objections, and books sales. When a customer needs a real human, it hands off smoothly.

**Voice** — calls answered in under a second, natural Russian speech, no "press 1 for sales" menus.  
**WhatsApp** — responds instantly, understands context, keeps the conversation going.  
**Instagram DM** — same agent, same knowledge, works across your social presence.

---

## Features

### For businesses
- **Instant setup** — describe your business in an onboarding chat, the AI figures out the rest
- **Always on** — handles calls and messages at 3am without complaining
- **Speaks your language** — Russian and Kyrgyz out of the box
- **Knows when to stop** — escalates to a live operator when the customer asks or the situation needs it
- **Multi-channel** — one configuration, three channels

### For developers
- **Multi-tenant** — one deployment serves many businesses, each fully isolated
- **Session memory** — conversations have context, not just the last message
- **Streaming voice** — first words play while the rest is still generating, ~300ms perceived latency
- **LiveKit voice pipeline** — VAD → STT → LLM → TTS, all streaming, no HTTP polling

---

## Architecture

```
                    ┌─────────────────────────────────┐
                    │           Customers              │
                    └──────┬──────────┬──────┬────────┘
                           │          │      │
                     Phone call   WhatsApp  Instagram
                           │          │      │
              ┌────────────▼──┐  ┌────▼──────▼────────┐
              │  Zadarma SIP  │  │   Meta Cloud API    │
              └────────┬──────┘  └──────────┬──────────┘
                       │                    │
              ┌────────▼──────┐             │
              │   LiveKit     │             │
              │  (SIP trunk)  │             │
              └────────┬──────┘             │
                       │                    │
              ┌────────▼────────────────────▼──────────┐
              │              NestJS Backend             │
              │                                        │
              │  ┌──────────┐  ┌──────────────────┐   │
              │  │ Channels │  │   Sales Agent    │   │
              │  │ Voice    │  │  Claude Haiku    │   │
              │  │ WhatsApp │  │  Classifier      │   │
              │  │Instagram │  │  Session Memory  │   │
              │  └──────────┘  └──────────────────┘   │
              │                                        │
              │  ┌──────────┐  ┌──────────────────┐   │
              │  │   CRM    │  │   PostgreSQL +   │   │
              │  │Contacts  │  │     Redis        │   │
              │  │Pipeline  │  └──────────────────┘   │
              │  └──────────┘                          │
              └────────────────────────────────────────┘
                       │
              ┌────────▼──────────────────────────────┐
              │         LiveKit Python Agent           │
              │  Silero VAD → Deepgram STT →           │
              │  Claude Haiku → ElevenLabs TTS         │
              └───────────────────────────────────────┘
```

---

## Tech stack

| Layer | Technology |
|---|---|
| Backend | NestJS (TypeScript) |
| Frontend | React + Next.js |
| Database | PostgreSQL via Prisma |
| Cache | Redis |
| LLM | Claude Haiku (Anthropic) |
| Voice pipeline | LiveKit Agents |
| STT | Deepgram nova-2 |
| TTS | ElevenLabs turbo |
| VAD | Silero |
| WhatsApp | Meta Cloud API |
| Voice telephony | Zadarma SIP |
| Auth | Google OAuth + JWT |

---

## Voice pipeline

The voice agent runs as a separate Python process using LiveKit Agents 1.5.2:

```
Phone call → Zadarma SIP → LiveKit SIP trunk
                                    ↓
                           LiveKit room created
                                    ↓
                Python agent picks up the room
                                    ↓
              Silero VAD detects speech end
                                    ↓
              Deepgram STT transcribes in ~200ms
                                    ↓
              Claude Haiku generates reply (streaming)
                                    ↓
              ElevenLabs TTS plays as words arrive
                                    ↓
              First audio chunk plays in ~600ms total
```

Perceived response time: **under 1 second** from end of customer speech.

---

## Getting started

### Prerequisites

- Node.js 20+
- Python 3.11+
- PostgreSQL
- Redis

### Environment

Copy `.env.example` to `server/.env` and fill in:

```env
# Core
DATABASE_URL=postgresql://...
JWT_SECRET=...

# AI
ANTHROPIC_API_KEY=sk-ant-...

# Voice
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=...
LIVEKIT_API_SECRET=...
DEEPGRAM_API_KEY=...
ELEVENLABS_API_KEY=...

# Telephony
ZADARMA_KEY=...
ZADARMA_SECRET=...

# Messaging
META_PAGE_ACCESS_TOKEN=...
META_VERIFY_TOKEN=...
```

### Run backend

```bash
cd server
npm install
npx prisma migrate deploy
npm run start:dev
```

### Run voice agent

```bash
cd livekit-agent
pip install -r requirements.txt
python agent.py dev
```

### Run frontend

```bash
cd client
npm install
npm run dev
```

---

## How the agent knows your business

During onboarding, a chat assistant asks:

- What do you sell?
- What are your prices?
- What are your delivery and payment terms?
- What questions do customers usually ask?

The answers become the agent's `agentContext` — injected into every conversation as part of the system prompt. No code changes needed. Update the profile, the agent adjusts within 15 seconds.

---

## Channels status

| Channel | Status |
|---|---|
| Voice (LiveKit) | ✅ Live |
| WhatsApp | ✅ Live |
| Instagram DM | ⏳ Pending Meta App Review |

---

## Roadmap

See [ROADMAP.md](ROADMAP.md) for planned features including:

- Google Sheets / CSV product catalog sync
- Subscription billing
- Telegram channel
- Embeddable website widget
- Kyrgyz language for voice
- Per-call analytics dashboard

---

## License

Private. All rights reserved.
