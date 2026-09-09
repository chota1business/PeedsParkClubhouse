-- Restored from the applied production migration history; no customer data.
-- pgcrypto lives in the "extensions" schema on this project, not "public",
-- but create_calendar_feed_token() locks search_path to 'public' only
-- (correct SECURITY DEFINER hygiene) — so the unqualified gen_random_bytes()
-- call couldn't resolve. Schema-qualify it instead of loosening search_path.
CREATE OR REPLACE FUNCTION public.create_calendar_feed_token()
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_token text;
begin
  if not private.is_admin() then
    raise exception 'Admin only';
  end if;

  v_token := encode(extensions.gen_random_bytes(24), 'hex');

  insert into calendar_feed_tokens (staff_id, token)
  values (auth.uid(), v_token);

  return v_token;
end;
$function$;
