# Digital Mosaic Wall

Next.js + Postgres (Neon on Vercel) event activation. Guests scan a QR code, upload a photo at `/upload`, and it flies into its tile on the big-screen mosaic at `/wall`. Organisers manage events and moderate photos at `/admin`.

## Setup
The app uses one Postgres database (Neon, free tier) connected through Vercel. It creates its own tables on first run and stores the photos in the database, so there is no SQL to run and no storage buckets to configure.

1. **Vercel → Storage → Create Database → Neon**, then connect it to this project. Vercel adds `DATABASE_URL` automatically.
2. Deploy (push to `main`).
3. Open `/admin`. The first visit asks you to create the admin password (or set `ADMIN_PASSWORD` in Vercel to fix it there).
4. A live event called "Digital Mosaic Wall" already exists: open `/wall` on the big screen and `/upload` (or the QR code) on phones. Add a target image and adjust settings in `/admin`.

**Local development:** `npm install`, put `DATABASE_URL` in `.env.local` (copy it from Vercel → Storage → your database → `.env.local` tab, or use any local Postgres), then `npm run dev`.

**Which event do links open?** `/upload` and `/wall` without a real event ID (including old `?event=demo` links) open the most recently created **live** event. For a guaranteed match, use the QR code and links from `/admin`, which carry the event ID.

**Simulation:** `/wall?simulate=1` runs the built-in demo animation with sample images (nothing is saved). Without a database the whole site runs in this demo mode.

**Setup check:** `/api/health` lists what is configured (no secret values).

## How it works
- Uploads are resized in the browser (Vercel caps request bodies at 4.5 MB), re-encoded with `sharp` (1200 px photo + 240 px tile) and stored in the database's `images` table, served from `/api/img/<id>` with permanent caching. About 750 photos use roughly 100–150 MB of Neon's free 0.5 GB.
- Approval goes through the `approve_submission` database function, which locks the event row and assigns a random free tile, so concurrent approvals never collide (a unique index also guarantees it). When every tile is taken, approved photos wait; removing a photo hands its tile to the one that has waited longest.
- Moderation: with **Auto approve** off, new photos wait in Admin → Submissions until approved. Turn it on per event in Settings, or set `AUTO_APPROVE=true` in Vercel to force it for every event.
- Uploads are validated by decoding the image on the server (not by the type the phone reports). EXIF rotation is respected, and iPhone HEIC photos are converted to JPEG in the browser.
- The wall checks for new photos every 3 seconds. The target image is blended over the tiles to reveal the final picture.
- `/admin` and `/api/admin/*` require an httpOnly session cookie signed with a random secret stored in the database.

## Not included yet
- Shared rate limiting: `/api/upload` allows 8 uploads per minute per IP, but only within one serverless instance.
- Automatic image moderation before auto-approval.
- Per-tile colour matching against the target image (tiles are placed randomly and the target is overlaid).
