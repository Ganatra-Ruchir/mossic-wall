import {NextResponse} from 'next/server';
import sharp from 'sharp';
import {one,saveImage} from '@/lib/db';
import {UUID,adminGuard,fail} from '@/lib/server';
export const runtime='nodejs';
export async function POST(req:Request,{params}:{params:Promise<{id:string}>}){const g=await adminGuard();if(g)return g;try{const {id}=await params;if(!UUID.test(id))return fail('Event not found',404);const file=(await req.formData()).get('file');if(!(file instanceof File)||file.size===0)return fail('Image is required',400);
let img:Buffer;try{img=await sharp(Buffer.from(await file.arrayBuffer())).rotate().resize(2000,2000,{fit:'inside',withoutEnlargement:true}).jpeg({quality:85,mozjpeg:true}).toBuffer()}catch{return fail('Could not read that image',415)}
const url=await saveImage(id,img);const event=await one('update events set target_image_url=$1,updated_at=now() where id=$2 returning *',[url,id]);if(!event)return fail('Event not found',404);return NextResponse.json({event})}catch(e){return fail(e)}}
