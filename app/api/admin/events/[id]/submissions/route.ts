import {NextResponse} from 'next/server';
import {q} from '@/lib/db';
import {UUID,adminGuard,fail} from '@/lib/server';
type Ctx={params:Promise<{id:string}>};
export async function GET(req:Request,{params}:Ctx){const g=await adminGuard();if(g)return g;try{const {id}=await params;if(!UUID.test(id))return fail('Event not found',404);const status=new URL(req.url).searchParams.get('status')||'pending';if(!['pending','approved','rejected'].includes(status))return fail('Invalid status',400);
return NextResponse.json({submissions:await q(`select * from submissions where event_id=$1 and status=$2 order by created_at ${status==='pending'?'asc':'desc'} limit 200`,[id,status])})}catch(e){return fail(e)}}
export async function POST(req:Request,{params}:Ctx){const g=await adminGuard();if(g)return g;try{const {id}=await params;if(!UUID.test(id))return fail('Event not found',404);const {action}=await req.json();if(action!=='approve_all')return fail('Unknown action',400);
const rows=await q<{id:string}>("select id from submissions where event_id=$1 and status='pending' order by created_at limit 500",[id]);for(const s of rows)await q('select approve_submission($1)',[s.id]);return NextResponse.json({ok:true,approved:rows.length})}catch(e){return fail(e)}}
