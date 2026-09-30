import {NextResponse} from 'next/server';
import sharp from 'sharp';
import {supabaseAdmin} from '@/lib/supabase';
import {UUID,fail} from '@/lib/server';
export const runtime='nodejs';
// Vercel rejects request bodies over 4.5 MB; the client downsizes photos before sending.
const MAX_BYTES=4*1024*1024;
export async function POST(req:Request){try{const fd=await req.formData();const file=fd.get('file');const eventId=String(fd.get('eventId')||'');const name=String(fd.get('name')||'').trim().slice(0,60)||null;
if(!(file instanceof File))return fail('Image is required',400);if(!file.type.startsWith('image/'))return fail('Unsupported image type',415);if(file.size>MAX_BYTES)return fail('Image exceeds 4 MB limit',413);
const sb=supabaseAdmin();if(!sb||eventId==='demo')return NextResponse.json({ok:true,status:'demo',message:'Demo upload accepted'});
if(!UUID.test(eventId))return fail('Invalid event link',400);
const {data:event,error:ee}=await sb.from('events').select('id,status,auto_approve').eq('id',eventId).maybeSingle();if(ee)throw ee;if(!event)return fail('Event not found',404);if(event.status!=='live')return fail('This event is not accepting photos right now',403);
let full:Buffer,thumb:Buffer;try{const img=sharp(Buffer.from(await file.arrayBuffer())).rotate();full=await img.clone().resize(1600,1600,{fit:'inside',withoutEnlargement:true}).jpeg({quality:85}).toBuffer();thumb=await img.clone().resize(320,320,{fit:'cover'}).jpeg({quality:78}).toBuffer()}catch{return fail('Could not read that image',415)}
const id=crypto.randomUUID();const path=`${eventId}/${id}.jpg`;
const up=await sb.storage.from('submissions').upload(path,full,{contentType:'image/jpeg',upsert:false});if(up.error)throw up.error;
const ut=await sb.storage.from('thumbnails').upload(path,thumb,{contentType:'image/jpeg',upsert:false});if(ut.error)throw ut.error;
const image_url=sb.storage.from('submissions').getPublicUrl(path).data.publicUrl;const thumbnail_url=sb.storage.from('thumbnails').getPublicUrl(path).data.publicUrl;
const {error}=await sb.from('submissions').insert({id,event_id:eventId,image_url,thumbnail_url,name,status:'pending'});if(error)throw error;
let status='pending';if(event.auto_approve||process.env.AUTO_APPROVE==='true'){const r=await sb.rpc('approve_submission',{p_id:id});if(r.error)throw r.error;status='approved'}
return NextResponse.json({ok:true,id,status})}catch(e){return fail(e)}}
