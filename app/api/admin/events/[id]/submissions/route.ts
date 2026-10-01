import {NextResponse} from 'next/server';
import {one,q} from '@/lib/db';
import {UUID,adminGuard,fail} from '@/lib/server';
type Ctx={params:Promise<{id:string}>};
const PAGE=60;

// List photos by status, newest first (pending: oldest first), with search and paging.
export async function GET(req:Request,{params}:Ctx){const g=await adminGuard();if(g)return g;try{const {id}=await params;if(!UUID.test(id))return fail('Event not found',404);
const sp=new URL(req.url).searchParams;const status=sp.get('status')||'pending';if(!['pending','approved','rejected'].includes(status))return fail('Invalid status',400);
const search=(sp.get('q')||'').trim().slice(0,80);const offset=Math.max(0,Math.min(100000,Number(sp.get('offset'))||0));
const where=`event_id=$1 and status=$2${search?` and (name ilike $3 or message ilike $3)`:''}`;
const args:unknown[]=[id,status];if(search)args.push(`%${search.replace(/[\\%_]/g,(c)=>'\\'+c)}%`);
const rows=await q(`select * from submissions where ${where} order by created_at ${status==='pending'?'asc':'desc'} limit ${PAGE} offset ${offset}`,args);
const total=(await one<{n:number}>(`select count(*)::int n from submissions where ${where}`,args))?.n??0;
return NextResponse.json({submissions:rows,total,hasMore:offset+rows.length<total})}catch(e){return fail(e)}}

// Bulk actions: approve_all | {action:'bulk', op, ids} | {action:'clear_all', confirm:<event name>}
export async function POST(req:Request,{params}:Ctx){const g=await adminGuard();if(g)return g;try{const {id}=await params;if(!UUID.test(id))return fail('Event not found',404);const b=await req.json();
if(b.action==='approve_all'){const rows=await q<{id:string}>("select id from submissions where event_id=$1 and status='pending' order by created_at limit 500",[id]);for(const s of rows)await q('select approve_submission($1)',[s.id]);return NextResponse.json({ok:true,approved:rows.length})}
if(b.action==='bulk'){const ids=Array.isArray(b.ids)?b.ids.filter((x:unknown)=>typeof x==='string'&&UUID.test(x)).slice(0,500):[];const fn={approve:'approve_submission',reject:'reject_submission',delete:'delete_submission'}[b.op as string];if(!fn)return fail('Unknown operation',400);if(!ids.length)return fail('No photos selected',400);
// Only photos of this event.
const own=await q<{id:string}>('select id from submissions where event_id=$1 and id = any($2::uuid[])',[id,ids]);for(const s of own)await q(`select ${fn}($1)`,[s.id]);return NextResponse.json({ok:true,done:own.length})}
if(b.action==='clear_all'){const ev=await one<{name:string}>('select name from events where id=$1',[id]);if(!ev)return fail('Event not found',404);if(String(b.confirm||'').trim()!==ev.name)return fail('Type the event name exactly to confirm',400);
const r=await one<{n:number}>('select clear_event_photos($1) n',[id]);return NextResponse.json({ok:true,deleted:r?.n??0})}
return fail('Unknown action',400)}catch(e){return fail(e)}}
