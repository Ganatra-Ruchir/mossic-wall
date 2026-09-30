import {NextResponse} from 'next/server';
import {fail,loadWall} from '@/lib/server';
export const dynamic='force-dynamic';
export async function GET(_:Request,{params}:{params:Promise<{id:string}>}){try{const data=await loadWall((await params).id);if(!data)return fail('Event not found',404);return NextResponse.json(data,{headers:{'Cache-Control':'no-store'}})}catch(e){return fail(e)}}
