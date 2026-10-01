import {NextResponse} from 'next/server';
import {one,q} from '@/lib/db';
import {UUID,adminGuard,fail} from '@/lib/server';
type Ctx={params:Promise<{id:string}>};
// approve = put on the wall · reject = remove from the wall (can be put back)
export async function POST(req:Request,{params}:Ctx){const g=await adminGuard();if(g)return g;try{const {id}=await params;if(!UUID.test(id))return fail('Submission not found',404);const {action}=await req.json();if(action!=='approve'&&action!=='reject')return fail('Unknown action',400);
return NextResponse.json({submission:await one(`select * from ${action==='approve'?'approve_submission':'reject_submission'}($1)`,[id])})}catch(e){return fail(e)}}
// Delete forever: the photo and its image files are removed from the database.
export async function DELETE(_:Request,{params}:Ctx){const g=await adminGuard();if(g)return g;try{const {id}=await params;if(!UUID.test(id))return fail('Submission not found',404);await q('select delete_submission($1)',[id]);return NextResponse.json({ok:true})}catch(e){return fail(e)}}
