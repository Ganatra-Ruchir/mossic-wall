// Setup diagnostics. Never returns secret values.
import {passwordMode} from './auth';
import {databaseUrl, one} from './db';

export type Check = {label: string; ok: boolean; detail: string};

export function explain(e: unknown): string {
  const raw = e && typeof e === 'object' ? JSON.stringify(e) + String((e as {message?: string}).message ?? '') : String(e);
  if (/DATABASE_URL is not set/.test(raw)) return 'No database connected. In Vercel → Storage, connect the Neon database to this project, then redeploy.';
  if (/password authentication failed|28P01/i.test(raw)) return 'The database rejected the login. In Vercel → Storage, reconnect the Neon database to this project, then redeploy.';
  if (/ENOTFOUND|ECONNREFUSED|EAI_AGAIN|timeout|getaddrinfo/i.test(raw)) return "The site can't reach the database. In Vercel → Storage, check the Neon database is Available and connected to this project.";
  return 'Unexpected database error. Check Vercel → Logs for details.';
}

export async function diagnose(): Promise<{ok: boolean; checks: Check[]}> {
  const checks: Check[] = [];
  const url = databaseUrl();
  checks.push({label: 'Database connection string', ok: !!url, detail: url ? 'set (DATABASE_URL)' : 'missing: connect a Neon database in Vercel → Storage'});
  if (url) {
    try {
      const r = await one<{events: number; live: number; photos: number}>(
        "select (select count(*) from events)::int events, (select count(*) from events where status='live')::int live, (select count(*) from submissions)::int photos");
      checks.push({label: 'Database', ok: true, detail: `connected: ${r?.events ?? 0} event(s), ${r?.photos ?? 0} photo(s)`});
      checks.push({label: 'Live event', ok: (r?.live ?? 0) > 0, detail: (r?.live ?? 0) > 0 ? `${r?.live} live` : 'none: in /admin open your event and press “Go live”'});
      const mode = await passwordMode();
      checks.push({label: 'Admin password', ok: mode !== 'none',
        detail: mode === 'env' ? 'set in Vercel (ADMIN_PASSWORD)' : mode === 'db' ? 'created in the app' : 'not created yet: open /admin to create it'});
    } catch (e) {
      console.error('[diagnose] database check failed', e);
      checks.push({label: 'Database', ok: false, detail: explain(e)});
    }
  }
  return {ok: checks.every((c) => c.ok), checks};
}
