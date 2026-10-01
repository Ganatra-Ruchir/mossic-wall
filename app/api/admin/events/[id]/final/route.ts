import {NextResponse} from 'next/server';
import sharp from 'sharp';
import {one,saveImage} from '@/lib/db';
import {UUID,adminGuard,fail} from '@/lib/server';
export const runtime='nodejs';
type Ctx={params:Promise<{id:string}>};
// Share the finished picture with guests: shown with a download button on the guest page after the event.
export async function POST(req:Request,{params}:Ctx){const g=await adminGuard();if(g)return g;try{const {id}=await params;if(!UUID.test(id))return fail('Event not found',404);
const file=(await req.formData()).get('file');if(!(file instanceof File)||file.size===0)return fail('Image is required',400);
let img:Buffer;try{img=await sharp(Buffer.from(await file.arrayBuffer())).resize(3200,3200,{fit:'inside',withoutEnlargement:true}).jpeg({quality:88,mozjpeg:true}).toBuffer()}catch{return fail('Could not read that image',415)}
const url=await saveImage(id,img);const event=await one('update events set final_image_url=$1,updated_at=now() where id=$2 returning *',[url,id]);if(!event)return fail('Event not found',404);return NextResponse.json({event})}catch(e){return fail(e)}}
export async function DELETE(_:Request,{params}:Ctx){const g=await adminGuard();if(g)return g;try{const {id}=await params;if(!UUID.test(id))return fail('Event not found',404);
const event=await one('update events set final_image_url=null,updated_at=now() where id=$1 returning *',[id]);return NextResponse.json({event})}catch(e){return fail(e)}}
