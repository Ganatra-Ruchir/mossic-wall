import {NextResponse} from 'next/server';
import {UUID,fail,requireDb} from '@/lib/server';
export async function POST(req:Request,{params}:{params:Promise<{id:string}>}){try{const {id}=await params;if(!UUID.test(id))return fail('Submission not found',404);const {action}=await req.json();if(action!=='approve'&&action!=='reject')return fail('Unknown action',400);const sb=requireDb();const {data,error}=await sb.rpc(action==='approve'?'approve_submission':'reject_submission',{p_id:id});if(error)throw error;return NextResponse.json({submission:data})}catch(e){return fail(e)}}
