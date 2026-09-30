import {NextResponse} from 'next/server';
import sharp from 'sharp';
import {supabaseAdmin} from '@/lib/supabase';
import {UUID,cleanText,clientIp,fail,latestLiveEventId,rateLimited} from '@/lib/server';
export const runtime='nodejs';
export const maxDuration=30;
// Vercel rejects request bodies over 4.5 MB; the client downsizes photos before sending.
const MAX_BYTES=4*1024*1024;
// Formats sharp can decode out of the box. HEIC is converted to JPEG in the browser first.
const FORMATS=new Set(['jpeg','png','webp','gif','avif','tiff']);

export async function POST(req:Request){try{
if(rateLimited(clientIp(req)))return fail("You're uploading very quickly. Please wait a minute and try again.",429);
const fd=await req.formData();const file=fd.get('file');let eventId=String(fd.get('eventId')||'');
const name=cleanText(fd.get('name'),60);const message=cleanText(fd.get('message'),140);
if(!(file instanceof File)||file.size===0)return fail('Please choose a photo.',400);
if(file.size>MAX_BYTES)return fail('That photo is too large (over 4 MB). Please try again.',413);

const sb=supabaseAdmin();
if(!sb)return NextResponse.json({ok:true,status:'demo',message:'Demo upload accepted'});
// Demo / missing links go to whichever event is live, instead of silently discarding the photo.
if(!eventId||eventId==='demo'){const live=await latestLiveEventId();if(!live)return fail('No event is accepting photos right now. Please scan the QR code on the big screen.',409);eventId=live}
if(!UUID.test(eventId))return fail('This upload link is not valid. Please scan the QR code again.',400);
const {data:event,error:ee}=await sb.from('events').select('id,status,auto_approve').eq('id',eventId).maybeSingle();if(ee)throw ee;
if(!event)return fail('Event not found. Please scan the QR code again.',404);
if(event.status!=='live')return fail('This event is not accepting photos right now.',403);

// Validate by decoding the actual bytes, not the MIME type the phone reports.
let full:Buffer,thumb:Buffer;try{const input=Buffer.from(await file.arrayBuffer());const meta=await sharp(input).metadata();
if(!meta.format||!FORMATS.has(meta.format)||!meta.width||!meta.height)return fail('That file is not a supported photo. Please use a JPG, PNG or WEBP image.',415);
const img=sharp(input,{animated:false}).rotate();
full=await img.clone().resize(1600,1600,{fit:'inside',withoutEnlargement:true}).jpeg({quality:85}).toBuffer();
thumb=await img.clone().resize(320,320,{fit:'cover',position:'attention'}).jpeg({quality:78}).toBuffer()}
catch{return fail('Could not read that photo. Please try another one.',415)}

const id=crypto.randomUUID();const path=`${eventId}/${id}.jpg`;
const up=await sb.storage.from('submissions').upload(path,full,{contentType:'image/jpeg',upsert:false});if(up.error)throw up.error;
const ut=await sb.storage.from('thumbnails').upload(path,thumb,{contentType:'image/jpeg',upsert:false});if(ut.error)throw ut.error;
const image_url=sb.storage.from('submissions').getPublicUrl(path).data.publicUrl;const thumbnail_url=sb.storage.from('thumbnails').getPublicUrl(path).data.publicUrl;
const {error}=await sb.from('submissions').insert({id,event_id:eventId,image_url,thumbnail_url,name,message,status:'pending'});if(error)throw error;
let status:'pending'|'approved'|'waiting'='pending';
if(event.auto_approve||process.env.AUTO_APPROVE==='true'){const r=await sb.rpc('approve_submission',{p_id:id});if(r.error)throw r.error;
// Approved but the grid is full: it waits for a free tile.
status=(r.data as {tile_index:number|null}|null)?.tile_index==null?'waiting':'approved'}
return NextResponse.json({ok:true,id,eventId,status})}catch(e){return fail(e)}}
