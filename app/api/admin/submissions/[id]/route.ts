import {NextResponse} from 'next/server';
import {one} from '@/lib/db';
import {UUID,adminGuard,fail} from '@/lib/server';
export async function POST(req:Request,{params}:{params:Promise<{id:string}>}){const g=await adminGuard();if(g)return g;try{const {id}=await params;if(!UUID.test(id))return fail('Submission not found',404);const {action}=await req.json();if(action!=='approve'&&action!=='reject')return fail('Unknown action',400);
return NextResponse.json({submission:await one(`select * from ${action==='approve'?'approve_submission':'reject_submission'}($1)`,[id])})}catch(e){return fail(e)}}
