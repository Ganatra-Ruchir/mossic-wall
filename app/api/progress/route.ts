import {NextResponse} from 'next/server';
import {one} from '@/lib/db';
import {UUID,fail} from '@/lib/server';
export const dynamic='force-dynamic';
// Small public endpoint for the guest page: how full the wall is.
export async function GET(req:Request){try{const id=new URL(req.url).searchParams.get('event')||'';if(!UUID.test(id))return fail('Event not found',404);
const e=await one<{approved_count:number;goal:number;status:string}>('select approved_count,goal,status from events where id=$1',[id]);if(!e)return fail('Event not found',404);
return NextResponse.json({count:e.approved_count,goal:e.goal,status:e.status},{headers:{'Cache-Control':'no-store'}})}catch(e){return fail(e)}}
