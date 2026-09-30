import {NextResponse} from 'next/server';
import {ADMIN_COOKIE,adminToken} from '@/lib/auth';
import {fail} from '@/lib/server';
export async function POST(req:Request){const token=await adminToken();if(!token)return fail('ADMIN_PASSWORD is not set on the server',500);const {password}=await req.json().catch(()=>({password:''}));if(typeof password!=='string'||password!==process.env.ADMIN_PASSWORD)return fail('Wrong password',401);const res=NextResponse.json({ok:true});res.cookies.set(ADMIN_COOKIE,token,{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',path:'/',maxAge:60*60*24*7});return res}
export async function DELETE(){const res=NextResponse.json({ok:true});res.cookies.delete(ADMIN_COOKIE);return res}
