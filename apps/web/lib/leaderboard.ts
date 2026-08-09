import { getPool } from './db';
import { getGameDate } from './config';
import { MAX_GUESSES } from './game';

// Leaderboard queries, scoped per channel (tenants each read their own
// channel's rows from their own database via getPool(host)). "Daily" is the
// current game day's solves, keyed by the same game_date the puzzle answer
// uses -- so the daily board resets at exactly the puzzle's reset boundary
// (RESET_HOUR/RESET_TIMEZONE, see lib/config.ts getGameDate). "Weekly" is
// every game_date since the current Monday (ISO week), "alltime" is
// everything ever recorded for the channel.

export type LeaderboardPeriod = 'daily' | 'weekly' | 'alltime';

export interface LeaderboardEntry {
  rank: number;
  username: string;
  points: number;
  // Daily only: how many guesses that solve took (weekly/alltime rows
  // aggregate across days and don't carry a single guess count).
  guessesUsed?: number | null;
  // True for the signed-in viewer's own row (highlighted in the UI).
  isYou: boolean;
}

export interface LeaderboardData {
  period: LeaderboardPeriod;
  // Today's game date (the daily window; the weekly window's end).
  gameDate: string;
  entries: LeaderboardEntry[];
}

const LEADERBOARD_LIMIT = 100;

// Points for a single solve: 1 guess -> 5, 5 guesses -> 1. Losses score
// nothing, and since boards only show solvers they're simply absent.
export function solvePoints(guessesUsed: number): number {
  return Math.max(0, MAX_GUESSES + 1 - guessesUsed);
}

// The Monday of the ISO week containing `gameDate` (YYYY-MM-DD), returned as
// a YYYY-MM-DD string. Weekly boards window over game_date >= this, so the
// week rolls over on the first Monday reset boundary, same rhythm as the
// daily board's reset.
export function weekStart(gameDate: string): string {
  const [year, month, day] = gameDate.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const dayOfWeek = date.getUTCDay(); // 0 = Sunday
  const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  date.setUTCDate(date.getUTCDate() - daysSinceMonday);
  return date.toISOString().slice(0, 10);
}

// Solve points derived at query time (never stored) so the formula can't
// drift from what the UI shows.
const POINTS_EXPR = `case when gr.solved then ${MAX_GUESSES + 1} - gr.guesses_used else 0 end`;

interface DailyRow {
  rank: number;
  username: string;
  points: number;
  guesses_used: number | null;
  is_you: boolean;
}

interface GroupedRow {
  username: string;
  points: number;
  is_you: boolean;
}

export async function getLeaderboard(
  channel: string,
  period: LeaderboardPeriod,
  host?: string | null,
  viewerUserId?: number | null
): Promise<LeaderboardData> {
  const pool = getPool(host);
  const gameDate = getGameDate(new Date(), host);
  const viewer = viewerUserId ?? null;

  if (period === 'daily') {
    const { rows } = await pool.query<DailyRow>(
      `select row_number() over (order by gr.guesses_used asc, gr.created_at asc)::int as rank,
              coalesce(u.display_name, u.username) as username,
              ${POINTS_EXPR} as points,
              gr.guesses_used,
              (u.id = $3) as is_you
       from game_results gr
       join users u on u.id = gr.user_id
       where gr.channel = $1 and gr.game_date = $2 and gr.solved
       order by gr.guesses_used asc, gr.created_at asc
       limit $4`,
      [channel, gameDate, viewer, LEADERBOARD_LIMIT]
    );
    return {
      period,
      gameDate,
      entries: rows.map((r) => ({
        rank: r.rank,
        username: r.username,
        points: r.points,
        guessesUsed: r.guesses_used,
        isYou: r.is_you,
      })),
    };
  }

  // Weekly/alltime: aggregate each player's solves in the window, ranked by
  // total points, then fewer total guesses, then earlier last solve. Only
  // players with at least one solve appear (a loss-only week scores 0 and
  // isn't a leaderboard position).
  const params: unknown[] = [channel];
  let dateFilter = '';
  if (period === 'weekly') {
    dateFilter = 'and gr.game_date >= $2 and gr.game_date <= $3';
    params.push(weekStart(gameDate), gameDate);
  }
  const viewerIndex = params.length + 1;
  params.push(viewer, LEADERBOARD_LIMIT);

  const { rows } = await pool.query<GroupedRow>(
    `select coalesce(u.display_name, u.username) as username,
            sum(${POINTS_EXPR})::int as points,
            max(gr.created_at) filter (where gr.solved) as last_solved,
            (u.id = $${viewerIndex}) as is_you
     from game_results gr
     join users u on u.id = gr.user_id
     where gr.channel = $1 ${dateFilter}
     group by u.id, coalesce(u.display_name, u.username)
     having count(*) filter (where gr.solved) > 0
     order by points desc, sum(gr.guesses_used) asc, last_solved asc
     limit $${viewerIndex + 1}`,
    params
  );

  return {
    period,
    gameDate,
    entries: rows.map((r, i) => ({
      rank: i + 1,
      username: r.username,
      points: r.points,
      isYou: r.is_you,
    })),
  };
}
