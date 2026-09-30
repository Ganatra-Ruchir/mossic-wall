import {NextResponse} from 'next/server';
import {UUID,fail,requireDb,statusCounts} from '@/lib/server';
type Ctx={params:Promise<{id:string}>};
export async function GET(_:Request,{params}:Ctx){try{const {id}=await params;if(!UUID.test(id))return fail('Event not found',404);const sb=requireDb();const {data:event,error}=await sb.from('events').select('*').eq('id',id).maybeSingle();if(error)throw error;if(!event)return fail('Event not found',404);return NextResponse.json({event,counts:await statusCounts(sb,id)})}catch(e){return fail(e)}}
export async function PATCH(req:Request,{params}:Ctx){try{const {id}=await params;if(!UUID.test(id))return fail('Event not found',404);const sb=requireDb();const b=await req.json();const patch:Record<string,unknown>={updated_at:new Date().toISOString()};
if('name' in b){const n=String(b.name).trim().slice(0,120);if(!n)return fail('Event name is required',400);patch.name=n}
if('status' in b){if(!['draft','live','ended'].includes(b.status))return fail('Invalid status',400);patch.status=b.status}
if('auto_approve' in b)patch.auto_approve=!!b.auto_approve;
if('final_message' in b)patch.final_message=String(b.final_message).slice(0,120);
if('rows' in b||'columns' in b){const {data:cur,error}=await sb.from('events').select('approved_count').eq('id',id).single();if(error)throw error;if(cur.approved_count>0)return fail('Grid size is locked once photos are on the wall',409);for(const k of ['rows','columns'] as const)if(k in b){const v=Math.round(Number(b[k]));if(!(v>=2&&v<=100))return fail('Rows and columns must be between 2 and 100',400);patch[k]=v}}
const {data,error}=await sb.from('events').update(patch).eq('id',id).select().single();if(error)throw error;return NextResponse.json({event:data})}catch(e){return fail(e)}}
