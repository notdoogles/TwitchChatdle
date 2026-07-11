# Guess the chatter

> Part of [TwitchChatdle](../../README.md): see the root README for the
> project overview and how the game works for players.

A small Next.js game: it shows a real chat message from a Twitch channel and
you guess who sent it. Five wrong guesses reveal five more messages from the
same person, one at a time.

Uses the same Postgres database the `apps/ingest` worker writes to (the
author uses Supabase, but any Postgres works, see the root README's
[Deployment](../../README.md#deployment) section). This app only reads
`users`/`messages` and adds one table of its own (`game_rounds`) to track
guesses server-side.

## Setup

```
npm install
cp .env.example .env.local   # fill in DATABASE_URL, TWITCH_CHANNEL, GAME_NAME, etc.
```

Run `db/schema.sql` once against your Supabase database (SQL editor in the
Supabase dashboard, or `psql "$DATABASE_URL" -f db/schema.sql`) to create
`game_rounds`.

```
npm run dev
```

## Running tests

```
npm test
```

Runs the [Vitest](https://vitest.dev) unit tests in `lib/` (message
filtering, config/env parsing, reset-time math, win/loss image listing,
and round creation/guess grading with a mocked database). No live database
connection is needed.

## Deploying to Vercel

1. Push this folder to a GitHub repo, import it in Vercel.
2. In the Vercel project settings, add env vars: `DATABASE_URL`,
   `TWITCH_CHANNEL`, and optionally `GAME_NAME`, `WINNER_MESSAGE`,
   `LOSER_MESSAGE`, `RESET_HOUR`, `RESET_TIMEZONE`, and
   `USERNAME_HINTS_LIMIT` (see `.env.example` for defaults).
3. If your Postgres provider is Supabase, use the **Transaction pooler**
   connection string (port `6543`), not the direct connection -- Vercel's
   serverless functions open a lot of short-lived connections and the
   direct connection limit runs out fast. Other providers may have similar
   pooling options worth using for the same reason.
4. Deploy. Free tier covers this comfortably -- the app is a handful of
   lightweight API routes plus a static page.

## How message selection works

Two filters run every time a round starts (`lib/game.ts`):

- **Uniqueness (R9K-style):** messages are normalized (trimmed, lowercased,
  whitespace collapsed) and grouped; only messages whose normalized text
  appears exactly once in the whole channel history are eligible. This is
  the same idea as IRC's r9k mode -- if it's been said before, it's spam or
  a copypasta, not a message you can attribute to one person.
- **Intelligibility:** `lib/textFilters.ts` rejects anything under ~12
  characters, under 3 words, a bare link, or mostly emote-like tokens
  (ALLCAPS like `KEKW`, camelCase like `PogChamp`, digit/letter mixes like
  `5Head`). It's a heuristic, not a dictionary -- tune the thresholds in
  `DEFAULTS` if it's too strict or too loose for your channel's chat style.

A round only picks chatters who have at least 5 messages passing both
filters, and always shows exactly 5 of them.

## Daily reset time

The game resets once per "game day," which by default rolls over at
midnight `America/New_York`. Set `RESET_HOUR` (0-23) and/or
`RESET_TIMEZONE` (any IANA timezone name) to change when that happens --
e.g. `RESET_HOUR=6` resets at 6am instead of midnight in the same timezone.
This is read by both the server (`lib/game.ts`, via `lib/config.ts`) and the
client (`GameBoard.tsx`'s countdown timer), so they always agree on the
boundary.

## Win/loss images

Drop image files into `public/static/winners/` and `public/static/losers/`
and one is picked at random and shown when a round ends. Any common image
format works (`.png`, `.jpg`/`.jpeg`, `.gif`, `.webp`, `.avif`, `.svg`) and
the two directories can hold different numbers of images. If a directory is
empty, no image is shown for that outcome. The list of available images is
read at build time (`lib/resultImages.ts`), so a new deploy/build is needed
to pick up newly added images.

## Notes

- Guesses are graded server-side (`game_rounds` stores the answer) so the
  correct username is never sent to the browser until the round ends.
- The guess box's autocomplete list is every chatter with an eligible
  message in the channel, capped at `USERNAME_HINTS_LIMIT` (default 300,
  set in `.env`) -- a hint, not a spoiler, since it doesn't indicate which
  one is correct. The cap is a UX choice, not a performance one, and the
  correct answer is always included in the list even if the channel has
  more eligible chatters than the cap.
- Theme defaults to the browser's system preference and can be overridden
  to light or dark; the choice is remembered in `localStorage`.
