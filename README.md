# Digital Mosaic Wall

Production-oriented Next.js + Supabase event activation based on the supplied specification. It provides `/upload`, `/wall`, and `/admin`, a Supabase SQL schema, server-side image processing, a local demo mode, and an event QR generator.

## Run locally
1. `npm install`
2. Copy `.env.example` to `.env.local` and add Supabase credentials for production mode. Without credentials the UI still runs in demo mode.
3. `npm run dev`
4. Open `/upload?event=demo`, `/wall?event=demo`, `/admin?event=demo`.

## Supabase
Run `supabase/schema.sql` in the Supabase SQL editor. Create/verify the three public buckets named `event-targets`, `submissions`, and `thumbnails`. For production, replace the demo event with a UUID event row and use a protected admin authentication layer before exposing moderation controls.

## Vercel
Set the environment variables from `.env.example`, deploy the repository, and set `NEXT_PUBLIC_APP_URL` to the deployed URL.

## Important production hardening
- Put `/admin` behind Supabase Auth or another server-side session check.
- Add a database function/transaction to allocate `tile_index` atomically so concurrent approvals cannot collide.
- Subscribe `/wall` to `submissions` INSERT/UPDATE events through Supabase Realtime and fetch only thumbnails.
- Add server-side rate limiting (for example via an edge middleware/provider) and optional image moderation before auto-approval.
- For 2,000+ tiles, switch the CSS tile preview to a single Canvas/WebGL compositor and keep the DOM only for the animation layer.
