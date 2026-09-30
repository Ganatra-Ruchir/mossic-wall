import MosaicWall from '@/components/MosaicWall';
export default async function Wall({searchParams}:{searchParams:Promise<{event?:string}>}){const p=await searchParams;return <MosaicWall eventId={p.event||'demo'}/>}
