-- Run ONCE in the Supabase SQL Editor.
-- Closes a critical hole: the "update own profile" policy allowed any
-- signed-in user to set is_admin = true on their own row (reading every
-- user's email + the chat moderator key). This locks UPDATE to the
-- non-privileged columns. Safe to re-run.

revoke update on table public.profiles from authenticated;
grant update (username, username_lower, avatar_url) on table public.profiles to authenticated;

-- Verify afterwards: this must return false for a NON-admin user
-- (test with their JWT in Supabase → a SQL editor using their token, or
-- simply trust the grant table below).
select grantee, privilege_type, column_name
from information_schema.column_privileges
where table_name = 'profiles' and privilege_type = 'UPDATE';

-- ALSO RECOMMENDED: rotate the chat moderator key, since it was readable
-- by any self-promoted admin until now:
--   1) update public.admin_settings set admin_key = '<new-random-key>';
--   2) set CHAT_ADMIN_KEY on Render to the same new key and redeploy.
