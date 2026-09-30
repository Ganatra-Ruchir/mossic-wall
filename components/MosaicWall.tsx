'use client';
import LiveMosaic from '@/components/wall/LiveMosaic';
import type {WallData} from '@/lib/types';
// Live wall when event data is given; otherwise the rehearsal demo (/wall?simulate=1).
export default function MosaicWall({eventId, initial}: {eventId: string; initial?: WallData}) {
  return <LiveMosaic eventId={eventId} initial={initial} demo={!initial} />;
}
