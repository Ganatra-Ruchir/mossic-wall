import AdminDashboard from '@/components/AdminDashboard';
export default async function Admin({searchParams}:{searchParams:Promise<{event?:string}>}){const p=await searchParams;return <AdminDashboard eventId={p.event||'demo'}/>}
