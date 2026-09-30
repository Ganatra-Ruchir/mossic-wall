import {NextResponse} from 'next/server';
import {supabaseAdmin} from './supabase';
type Admin=NonNullable<ReturnType<typeof supabaseAdmin>>;
export const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function fail(e:unknown,status=500){const message=e instanceof Error?e.message:e&&typeof e==='object'&&'message' in e?String((e as {message:unknown}).message):typeof e==='string'?e:'Request failed';return NextResponse.json({error:message},{status})}
export function requireDb(){const sb=supabaseAdmin();if(!sb)throw new Error('Supabase is not configured');return sb}
// PostgREST caps responses at 1000 rows; large grids need paging.
export async function approvedTiles(sb:Admin,eventId:string){const out:{id:string;thumbnail_url:string;tile_index:number}[]=[];for(let from=0;;from+=1000){const {data,error}=await sb.from('submissions').select('id,thumbnail_url,tile_index').eq('event_id',eventId).eq('status','approved').not('tile_index','is',null).order('tile_index').range(from,from+999);if(error)throw error;out.push(...data);if(data.length<1000)break}return out}
export async function loadWall(eventId:string){const sb=supabaseAdmin();if(!sb||!UUID.test(eventId))return null;const {data:event,error}=await sb.from('events').select('*').eq('id',eventId).maybeSingle();if(error)throw error;if(!event)return null;return {event,tiles:await approvedTiles(sb,eventId)}}
export async function statusCounts(sb:Admin,eventId:string){const q=(s:string)=>sb.from('submissions').select('id',{count:'exact',head:true}).eq('event_id',eventId).eq('status',s);const [p,a,r]=await Promise.all([q('pending'),q('approved'),q('rejected')]);return {pending:p.count||0,approved:a.count||0,rejected:r.count||0}}
