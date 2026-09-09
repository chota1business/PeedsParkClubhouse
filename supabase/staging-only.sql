-- Apply only to dwnocyvunvswdfgtmwst after migration replay.
-- Staging submissions must never notify the production owner.
create or replace function private.notify_owner(p_type text,p_record jsonb)
returns void language plpgsql security definer set search_path=public
as $$ begin return; end; $$;
select cron.unschedule(jobid) from cron.job
where jobname in ('phase9-enquiry-digest','phase9-booking-digest');
