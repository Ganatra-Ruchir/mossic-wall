import UploadClient from '@/components/UploadClient';
export default async function Upload({searchParams}:{searchParams:Promise<{event?:string}>}){const p=await searchParams;return <UploadClient eventId={p.event||'demo'}/>}
