import {NextResponse} from 'next/server';
import {one} from '@/lib/db';
import {UUID,adminGuard,fail,statusCounts} from '@/lib/server';
import {normalizeDesign} from '@/lib/design';
type Ctx={params:Promise<{id:string}>};
export async function GET(_:Request,{params}:Ctx){const g=await adminGuard();if(g)return g;try{const {id}=await params;if(!UUID.test(id))return fail('Event not found',404);const event=await one('select * from events where id=$1',[id]);if(!event)return fail('Event not found',404);return NextResponse.json({event,counts:await statusCounts(id)})}catch(e){return fail(e)}}
export async function PATCH(req:Request,{params}:Ctx){const g=await adminGuard();if(g)return g;try{const {id}=await params;if(!UUID.test(id))return fail('Event not found',404);const b=await req.json();
const set:string[]=[];const vals:unknown[]=[];const add=(col:string,v:unknown)=>{vals.push(v);set.push(`${col}=$${vals.length}`)};
if('name' in b){const n=String(b.name).trim().slice(0,120);if(!n)return fail('Event name is required',400);add('name',n)}
if('status' in b){if(!['draft','live','ended'].includes(b.status))return fail('Invalid status',400);add('status',b.status)}
if('auto_approve' in b)add('auto_approve',!!b.auto_approve);
if('final_message' in b)add('final_message',String(b.final_message).slice(0,120));
if('design' in b){const cur=await one<{design:unknown}>('select design from events where id=$1',[id]);add('design',JSON.stringify(normalizeDesign({...(cur?.design as object||{}),...(b.design||{})})))}
if(b.reveal===true)set.push('reveal_token=reveal_token+1');
if('fly_from' in b){if(!['random','left','right','top','bottom'].includes(b.fly_from))return fail('Invalid side',400);add('fly_from',b.fly_from)}
if('goal' in b){const v=Math.round(Number(b.goal));if(!(v>=2&&v<=10000))return fail('Photos for the big picture must be between 2 and 10,000',400);add('goal',v)}
if('rows' in b||'columns' in b){const cur=await one<{approved_count:number}>('select approved_count from events where id=$1',[id]);if(!cur)return fail('Event not found',404);if(cur.approved_count>0)return fail('Grid size is locked once photos are on the wall',409);
for(const k of ['rows','columns'] as const)if(k in b){const v=Math.round(Number(b[k]));if(!(v>=2&&v<=100))return fail('Rows and columns must be between 2 and 100',400);add(k,v)}}
vals.push(id);const event=await one(`update events set ${[...set,'updated_at=now()'].join(',')} where id=$${vals.length} returning *`,vals);if(!event)return fail('Event not found',404);return NextResponse.json({event})}catch(e){return fail(e)}}
