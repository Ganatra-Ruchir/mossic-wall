import {NextResponse,type NextRequest} from 'next/server';
import {isAdmin} from '@/lib/auth';
export async function middleware(req:NextRequest){const p=req.nextUrl.pathname;if(p==='/admin/login'||p==='/api/admin/login')return NextResponse.next();if(await isAdmin(req))return NextResponse.next();if(p.startsWith('/api/'))return NextResponse.json({error:'Unauthorized'},{status:401});const u=req.nextUrl.clone();u.pathname='/admin/login';u.search='';return NextResponse.redirect(u)}
export const config={matcher:['/admin/:path*','/api/admin/:path*']};
