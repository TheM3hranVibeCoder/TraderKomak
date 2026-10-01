-- Admin panel: last-known IP + country per user.
--
-- WHY: the admin panel used to ask the CHAT SERVER for a visitor's IP (only a
-- WebSocket endpoint sees a connection's address). With no market server that
-- answer never arrives, and for an OFFLINE user a live IP is meaningless
-- anyway — so each signed-in visitor now records its own public IP + country
-- once per session, and the panel reads those rows.
--
-- RLS note: NO new policies needed. public.user_emails already allows
--   - a user to insert/update their OWN row ("write own email")
--   - admins to read ALL rows ("admin reads emails")
-- so the client upserts its own row and the admin panel selects them.
--
-- Privacy: this stores the IP address of your own users. Delete the rows (or
-- set RECORD_LOCATION = false in apps/web/src/services/location.ts) to stop
-- collecting; nothing else in the app depends on these columns.

alter table public.user_emails add column if not exists last_ip text;
alter table public.user_emails add column if not exists last_country text;
alter table public.user_emails add column if not exists last_country_code text;
alter table public.user_emails add column if not exists last_seen_at timestamptz;
