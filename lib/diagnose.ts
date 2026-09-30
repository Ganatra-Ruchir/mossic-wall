// Setup diagnostics. Never returns secret values: only whether each setting is
// present, which role a key belongs to, and whether the database answers.
import {supabaseAdmin} from './supabase';

export type Check = {label: string; ok: boolean; detail: string};

/** Role inside a Supabase JWT key ("anon" / "service_role"), or the new key format. */
function keyKind(key: string | undefined): string {
  if (!key) return 'missing';
  if (key.startsWith('sb_secret_')) return 'secret';
  if (key.startsWith('sb_publishable_')) return 'publishable';
  try {
    const payload = JSON.parse(Buffer.from(key.split('.')[1] ?? '', 'base64url').toString('utf8'));
    return typeof payload.role === 'string' ? payload.role : 'unknown';
  } catch {
    return 'unreadable';
  }
}

/** Turns a Supabase / network error into the one thing to fix. */
export function explain(e: unknown): string {
  const raw = e && typeof e === 'object' ? JSON.stringify(e) + String((e as {message?: string}).message ?? '') : String(e);
  if (/JWS|JWT|Invalid API key|PGRST301|PGRST302|"status":40[13]\b/i.test(raw))
    return 'Supabase rejected the key. In Vercel, set SUPABASE_SERVICE_ROLE_KEY to the service_role (secret) key from Supabase → Project Settings → API Keys, then redeploy.';
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|EAI_AGAIN|getaddrinfo|network|timeout/i.test(raw))
    return "The site can't reach Supabase. Check NEXT_PUBLIC_SUPABASE_URL in Vercel (it looks like https://xxxx.supabase.co), and open your Supabase dashboard: free projects pause after a week unused, so click Restore project if you see it.";
  if (/42P01|PGRST205|does not exist|schema cache|"status":404\b/i.test(raw))
    return 'The database tables are missing. In Supabase → SQL Editor, paste all of supabase/schema.sql and click Run.';
  if (/42703|column/i.test(raw))
    return 'The database is out of date. In Supabase → SQL Editor, run supabase/schema.sql again (it is safe to re-run).';
  return 'Unexpected database error. Open /api/health on this site and send the result.';
}

export async function diagnose(): Promise<{ok: boolean; checks: Check[]}> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = keyKind(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const service = keyKind(process.env.SUPABASE_SERVICE_ROLE_KEY);
  const checks: Check[] = [
    {label: 'NEXT_PUBLIC_SUPABASE_URL', ok: !!url && /^https?:\/\/.+/.test(url),
      detail: url ? (/\.supabase\.co\/?$/.test(url) ? 'set' : 'set, but it does not end in .supabase.co. Check for typos or a trailing path') : 'missing in Vercel → Settings → Environment Variables'},
    {label: 'NEXT_PUBLIC_SUPABASE_ANON_KEY', ok: anon === 'anon' || anon === 'publishable',
      detail: anon === 'service_role' || anon === 'secret' ? 'this is the SECRET key. Put the anon / publishable key here' : anon === 'missing' ? 'missing' : anon === 'anon' || anon === 'publishable' ? 'set (anon key)' : `not a Supabase key (${anon})`},
    {label: 'SUPABASE_SERVICE_ROLE_KEY', ok: service === 'service_role' || service === 'secret',
      detail: service === 'anon' || service === 'publishable' ? 'this is the ANON key. Put the service_role / secret key here' : service === 'missing' ? 'missing' : service === 'service_role' || service === 'secret' ? 'set (service_role key)' : `not a Supabase key (${service})`},
    {label: 'ADMIN_PASSWORD', ok: !!process.env.ADMIN_PASSWORD, detail: process.env.ADMIN_PASSWORD ? 'set' : 'missing: /admin cannot log in'},
  ];

  const sb = supabaseAdmin();
  if (sb) {
    try {
      // head:true responses carry no error body, so keep the HTTP status for explain().
      const all = await sb.from('events').select('id', {count: 'exact', head: true});
      if (all.error) throw {...all.error, status: all.status};
      const count = all.count;
      const live = await sb.from('events').select('id', {count: 'exact', head: true}).eq('status', 'live');
      if (live.error) throw {...live.error, status: live.status};
      checks.push({label: 'Database', ok: true, detail: `connected: ${count ?? 0} event(s)`});
      checks.push({label: 'Live event', ok: (live.count ?? 0) > 0,
        detail: (live.count ?? 0) > 0 ? `${live.count} live` : 'none: in /admin open your event and press “Go live”'});
      const buckets = await sb.storage.listBuckets();
      const names = new Set((buckets.data ?? []).map((b) => b.name));
      const missing = ['submissions', 'thumbnails', 'event-targets'].filter((b) => !names.has(b));
      checks.push({label: 'Storage buckets', ok: !buckets.error && missing.length === 0,
        detail: buckets.error ? explain(buckets.error) : missing.length ? `missing: ${missing.join(', ')}. Run supabase/schema.sql` : 'all 3 present'});
    } catch (e) {
      console.error('[diagnose] database check failed', e);
      checks.push({label: 'Database', ok: false, detail: explain(e)});
    }
  } else {
    checks.push({label: 'Database', ok: false, detail: 'not configured: the site runs in demo mode and uploads are not saved'});
  }
  return {ok: checks.every((c) => c.ok), checks};
}
