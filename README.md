# TwitchChatdle

**A daily "guess who sent this chat message" game for your Twitch
community**, Wordle-style, but the answer is one of your own chatters.

Every day, TwitchChatdle picks a real message from your channel's chat
history and challenges players to guess who sent it. Guess wrong and you
get another message from the same person, up to 5 tries. Everyone who plays
that day sees the same message set and the same answer, so it works great
as a shared "today's puzzle" for a Discord/Twitch community.

This repo is fully open source: fork it, run it for your own channel, and
tweak the branding, images, and copy to match your own community.

## How it works (for players)

1. A chat message from the channel is shown, with the sender hidden.
2. You guess a username (autocomplete suggests real chatters as hints, but
   doesn't give away the answer).
3. Wrong guess → another message from the same person is revealed. Right
   guess → you win and see who it was.
4. You get 5 guesses per day. The round resets once every 24 hours (the
   reset time is configurable, see below).

Messages are picked so they're actually attributable to one person: the
game only uses messages that are unique in the channel's history (so
copypasta/spam doesn't get picked) and skips very short or emote-only
messages that wouldn't give a fair signal either way.

## Repo structure

This is an npm-workspaces monorepo with two apps that share one Postgres
database:

```
TwitchChatdle/
├── apps/
│   ├── web/      Next.js game (the player-facing app): see apps/web/README.md
│   └── ingest/   Always-on worker that logs a Twitch channel's chat: see apps/ingest/README.md
└── package.json  Root workspace config (npm workspaces)
```

They're split into two apps because they have different hosting needs:

- **`apps/web`** is a normal Next.js app, it only *reads* chat history
  (plus a small `game_rounds` table it owns) and can run anywhere Next.js
  runs, including serverless platforms like Vercel.
- **`apps/ingest`** has to stay connected to Twitch chat continuously to
  log messages as they happen, so it needs an always-on process. It is
  **not** serverless-compatible and won't work on Vercel.

Both apps talk to the same Postgres database: `ingest` populates
`users`/`messages` (and lets you exclude bots/usernames from being logged
at all), and `web` reads from those tables and adds its own `game_rounds`
table to track each day's answer.

See [`apps/web/README.md`](apps/web/README.md) and
[`apps/ingest/README.md`](apps/ingest/README.md) for full setup
instructions, environment variables, and configuration options for each app
(display name/branding, win/loss images, daily reset time, username
exclusion, etc.).

## Requirements

- Node.js 18+ and npm.
- A Postgres database (any provider works, see [Deployment](#deployment)).
- A Twitch channel to read chat from. No Twitch API keys/auth needed:
  `apps/ingest` connects to Twitch IRC anonymously via
  [`tmi.js`](https://github.com/tmijs/tmi.js) to read public chat.

## Quick start

```
git clone <your-fork-url>
cd TwitchChatdle
npm install
```

Then follow the setup steps in each app's README, in this order:

1. [`apps/ingest`](apps/ingest/README.md): connect to your channel, create
   the database tables, and start logging chat.
2. [`apps/web`](apps/web/README.md): point it at the same database, create
   the `game_rounds` table, and run the game.

Give `ingest` some time to log real chat before playing. The game needs at
least 5 unique, readable messages from the same chatter to build a round.

## Deployment

The author runs this on **Vercel** (`apps/web`), **Supabase** (Postgres),
and their **own always-on server** for `apps/ingest`. None of that is a
requirement, it's just what's convenient for the author's setup:

- `apps/web` is a standard Next.js app and can be deployed anywhere Next.js
  is supported (Vercel, a Node server, Docker, etc.).
- Any managed or self-hosted Postgres works (Supabase, Neon, RDS, a VM
  running Postgres, ...). `apps/web` and `apps/ingest` only need a
  `DATABASE_URL` connection string.
- `apps/ingest` just needs *any* host that keeps a Node process running
  continuously (a VPS, Fly.io, Railway, a Raspberry Pi, etc.). It cannot
  run on serverless platforms since it holds a persistent connection to
  Twitch chat.

## Streamers using TwitchChatdle

| Streamer | Game |
| --- | --- |
| [elliebwalker](https://twitch.tv/elliebwalker) | [elliebdle.doogl.es](https://elliebdle.doogl.es) |

Running this for your own channel? Let me know (see [Contact](#contact)) and I'll add you to the list above.

## Contributing

Issues, suggestions, and pull requests are welcome, whether that's a bug fix, a new
configuration option, or support for a use case this wasn't originally
built for. There's no formal process: open an issue to discuss bigger
changes first if you'd like feedback before doing the work, or just open a
PR directly for smaller stuff.

A [GitHub Actions workflow](.github/workflows/tests.yml) runs the test
suites for both apps on every push and pull request (see each app's
README for how to run them locally: [`apps/web`](apps/web/README.md#running-tests),
[`apps/ingest`](apps/ingest/README.md#running-tests)).

## License

MIT, see [`LICENSE`](LICENSE).

## Contact

Questions, bug reports, suggestions, or just want to say hi? I'm most reachable on
**Discord**.

- Discord: [notdoogles](https://www.discord.com/users/219505484984614912)
- Twitch: [notdoogles](https://twitch.tv/notdoogles)
- GitHub: [notdoogles](https://github.com/notdoogles)