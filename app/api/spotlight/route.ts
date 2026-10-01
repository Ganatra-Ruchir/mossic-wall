import {NextResponse} from 'next/server';
import {one} from '@/lib/db';
import {UUID,clientIp,fail,rateLimited} from '@/lib/server';
// "Show me on the big screen": the wall zooms this photo to the centre for a few seconds.
export async function POST(req:Request){try{
if(rateLimited('spot:'+clientIp(req),6))return fail('The big screen is busy. Try again in a moment.',429);
const {id}=await req.json().catch(()=>({}));
if(typeof id!=='string'||!UUID.test(id))return fail('Invalid photo',400);
const s=await one<{event_id:string}>("select s.event_id from submissions s join events e on e.id=s.event_id where s.id=$1 and s.status='approved' and s.tile_index is not null and e.status='live'",[id]);
if(!s)return fail('This photo isn’t on the wall yet.',409);
// One at a time: don't interrupt a spotlight that started less than 8 s ago.
const r=await one<{id:string}>("update events set spotlight_id=$1,spotlight_at=now() where id=$2 and (spotlight_at is null or spotlight_at < now()-interval '8 seconds') returning id",[id,s.event_id]);
if(!r)return fail('Another photo is on the big screen right now. Try again in a few seconds.',429);
return NextResponse.json({ok:true})}catch(e){return fail(e)}}
