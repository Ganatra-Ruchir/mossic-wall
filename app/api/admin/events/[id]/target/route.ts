import {NextResponse} from 'next/server';
import sharp from 'sharp';
import {UUID,fail,requireDb} from '@/lib/server';
export const runtime='nodejs';
export async function POST(req:Request,{params}:{params:Promise<{id:string}>}){try{const {id}=await params;if(!UUID.test(id))return fail('Event not found',404);const sb=requireDb();const file=(await req.formData()).get('file');if(!(file instanceof File)||!file.type.startsWith('image/'))return fail('Image is required',400);
let img:Buffer;try{img=await sharp(Buffer.from(await file.arrayBuffer())).rotate().resize(2400,2400,{fit:'inside',withoutEnlargement:true}).jpeg({quality:88}).toBuffer()}catch{return fail('Could not read that image',415)}
const path=`${id}/${crypto.randomUUID()}.jpg`;const up=await sb.storage.from('event-targets').upload(path,img,{contentType:'image/jpeg'});if(up.error)throw up.error;
const target_image_url=sb.storage.from('event-targets').getPublicUrl(path).data.publicUrl;const {data,error}=await sb.from('events').update({target_image_url,updated_at:new Date().toISOString()}).eq('id',id).select().single();if(error)throw error;return NextResponse.json({event:data})}catch(e){return fail(e)}}
