# Digital Mosaic Wall

Next.js + Supabase event activation. Guests scan a QR code, upload a photo at `/upload`, and it flies into its tile on the big-screen mosaic at `/wall`. Organisers manage events and moderate photos at `/admin`.

## Setup
1. `npm install`
2. Copy `.env.example` to `.env.local` and fill in the Supabase URL, anon key, service role key and an `ADMIN_PASSWORD`.
3. In the Supabase SQL Editor, run the whole of `supabase/schema.sql`. It is safe to re-run. **Existing projects:** also run `supabase/fix-full-wall.sql` once (safe to re-run). It creates the tables, the storage buckets, the tile allocation functions and enables Realtime on `submissions`.
4. `npm run dev`, open `/admin`, log in, create an event, upload a target image, press **Go live**.
5. Show the QR code to guests. Open the wall link on the display.

**Which event do links open?** `/upload` and `/wall` without a real event ID (including old `?event=demo` links) open the most recently created **live** event, so the home-page buttons and any old QR code always reach the real wall. For a guaranteed match, use the QR code and links from `/admin`, which carry the event ID.

**Simulation:** `/wall?simulate=1` runs the built-in demo animation with sample images (nothing is saved). Without Supabase credentials the whole site runs in this demo mode.

## Vercel
Import the repository and set the same environment variables (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_PASSWORD`, optionally `AUTO_APPROVE`) in Project → Settings → Environment Variables, then deploy.

## How it works
- Uploads are resized in the browser (Vercel caps request bodies at 4.5 MB), re-encoded with `sharp`, and stored in the `submissions` and `thumbnails` buckets.
- Approval goes through the `approve_submission` database function, which locks the event row and assigns a random free tile, so concurrent approvals never collide (a unique index also guarantees it). When every tile is taken, approved photos wait; removing a photo hands its tile to the one that has waited longest.
- Moderation: with **Auto approve** off, new photos wait in Admin → Submissions until approved. Turn it on per event in Settings, or set `AUTO_APPROVE=true` in Vercel to force it for every event.
- Uploads are validated by decoding the image on the server (not by the type the phone reports). EXIF rotation is respected, and iPhone HEIC photos are converted to JPEG in the browser.
- The wall subscribes to Supabase Realtime and also polls every 15 s. The target image is blended over the tiles to reveal the final picture.
- `/admin` and `/api/admin/*` are protected by middleware using an httpOnly cookie derived from `ADMIN_PASSWORD`.

## Not included yet
- Shared rate limiting: `/api/upload` allows 8 uploads per minute per IP, but only within one serverless instance.
- Automatic image moderation before auto-approval.
- Per-tile colour matching against the target image (tiles are placed randomly and the target is overlaid).
