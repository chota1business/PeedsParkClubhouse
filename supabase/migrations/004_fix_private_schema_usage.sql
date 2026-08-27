-- Fix a bug introduced in 003_security_hardening.sql: `revoke all on schema
-- private from anon, authenticated` also revoked USAGE, which Postgres
-- requires to invoke ANY function in that schema — including from inside an
-- RLS policy evaluated as that role. This silently broke every staff
-- permission check. RPC exposure was never at risk from granting USAGE:
-- PostgREST only exposes functions from schemas in its configured "exposed
-- schemas" list (public by default) — moving these functions out of `public`
-- is what closed that gap, independent of the USAGE grant.
grant usage on schema private to anon, authenticated;
