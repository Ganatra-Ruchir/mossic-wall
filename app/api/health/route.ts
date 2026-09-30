import {NextResponse} from 'next/server';
import {diagnose} from '@/lib/diagnose';
export const dynamic='force-dynamic';
// Setup check for the organiser: which settings are present and whether the database answers. No secret values.
export async function GET(){return NextResponse.json(await diagnose(),{headers:{'Cache-Control':'no-store'}})}
