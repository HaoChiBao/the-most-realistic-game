# THE MOST REALISTIC GAME

A minimalist terminal text-adventure. Every session boots a brand-new,
surprising world with its own hidden tension, hidden rules, and autonomous
characters. The world keeps moving whether you act or not. Any input is a
valid action.

The "brain" is a DeepSeek model served through NVIDIA NIM's OpenAI-compatible
API, streamed straight into a CRT-style terminal. Your API key stays on the
server and is never exposed to the browser.

## Stack

- Next.js 15 (App Router) + React 19 + TypeScript
- Server route `/api/game` streams tokens from NVIDIA NIM
- Zero client-side secrets; the model prompt lives in `lib/systemPrompt.ts`

## Getting started

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create `.env.local` from the template and add your NVIDIA NIM key:

   ```bash
   cp .env.example .env.local
   ```

   Get a free key at https://build.nvidia.com (it looks like `nvapi-...`).

3. Run the dev server:

   ```bash
   npm run dev
   ```

   Open http://localhost:3000.

## Configuration

| Variable       | Default                                  | Notes                              |
| -------------- | ---------------------------------------- | ---------------------------------- |
| `NIM_API_KEY`  | —                                        | Required. Your NVIDIA NIM key.     |
| `NIM_MODEL`    | `deepseek-ai/deepseek-v3_1`              | Any DeepSeek model on NIM.         |
| `NIM_BASE_URL` | `https://integrate.api.nvidia.com/v1`    | OpenAI-compatible endpoint.        |

## Deploying to Vercel

Push to a Git repo, import the project in Vercel, and add the environment
variables above in Project Settings → Environment Variables. No other
configuration is required.

## Design notes

- Player input is capped at 140 characters (about one sentence) on both the
  client and the server, so no one can smuggle in huge prompts.
- The engine ends a session by emitting an `<END>` token, which the terminal
  hides and uses to offer a fresh world.
- The full game-design system prompt lives in `lib/systemPrompt.ts`.
