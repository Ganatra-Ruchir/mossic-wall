import {NextResponse} from 'next/server';
import {one,q} from '@/lib/db';
import {adminGuard,fail} from '@/lib/server';
export async function GET(){const g=await adminGuard();if(g)return g;try{return NextResponse.json({events:await q('select * from events order by created_at desc')})}catch(e){return fail(e)}}
export async function POST(req:Request){const g=await adminGuard();if(g)return g;try{const b=await req.json();const name=String(b.name||'').trim().slice(0,120);if(!name)return fail('Event name is required',400);const rows=Math.round(Number(b.rows)||25),columns=Math.round(Number(b.columns)||30);if(rows<2||rows>100||columns<2||columns>100)return fail('Rows and columns must be between 2 and 100',400);
return NextResponse.json({event:await one('insert into events(name,rows,columns) values($1,$2,$3) returning *',[name,rows,columns])})}catch(e){return fail(e)}}
