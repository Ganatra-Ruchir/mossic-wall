export const ADMIN_COOKIE='mosaic_admin';
type CookieReader={cookies:{get(name:string):{value:string}|undefined}};
// Session token is derived from the password, so changing ADMIN_PASSWORD logs everyone out.
export async function adminToken(){const p=process.env.ADMIN_PASSWORD;if(!p)return null;const d=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`mosaic-admin:${p}:${process.env.SUPABASE_SERVICE_ROLE_KEY||''}`));return Array.from(new Uint8Array(d),b=>b.toString(16).padStart(2,'0')).join('')}
export async function isAdmin(req:CookieReader){const t=await adminToken();return !!t&&req.cookies.get(ADMIN_COOKIE)?.value===t}
