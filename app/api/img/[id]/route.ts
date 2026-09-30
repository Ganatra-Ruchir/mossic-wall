import {one} from '@/lib/db';
import {UUID} from '@/lib/server';
export const runtime='nodejs';
// Images never change once stored, so browsers and Vercel's CDN may cache them forever.
export async function GET(_:Request,{params}:{params:Promise<{id:string}>}){const {id}=await params;if(!UUID.test(id))return new Response('Not found',{status:404});
try{const r=await one<{data:Buffer;content_type:string}>('select data,content_type from images where id=$1',[id]);if(!r)return new Response('Not found',{status:404});
return new Response(new Uint8Array(r.data),{headers:{'Content-Type':r.content_type,'Cache-Control':'public, max-age=31536000, s-maxage=31536000, immutable','Content-Length':String(r.data.length)}})}
catch(e){console.error('[img]',e);return new Response('Error',{status:500})}}
