create table public.website_settings (
  id integer primary key check (id=1),
  content jsonb not null default '{}'::jsonb check (jsonb_typeof(content)='object' and octet_length(content::text)<100000),
  version integer not null default 1,
  updated_at timestamptz not null default now()
);
insert into public.website_settings(id) values(1);
alter table public.website_settings enable row level security;
revoke all on public.website_settings from anon,authenticated;
grant select on public.website_settings to anon,authenticated;
grant update(content) on public.website_settings to authenticated;
create policy website_settings_read on public.website_settings for select to anon,authenticated using (true);
create policy website_settings_admin_update on public.website_settings for update to authenticated using (private.is_admin()) with check (private.is_admin());
create table public.website_settings_history (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id), published_at timestamptz not null default now(),
  version integer not null, previous_content jsonb not null, content jsonb not null
);
alter table public.website_settings_history enable row level security;
revoke all on public.website_settings_history from anon,authenticated;
grant select on public.website_settings_history to authenticated;
create policy website_settings_history_admin_read on public.website_settings_history for select to authenticated using (private.is_admin());
create function private.audit_website_settings() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if not private.is_admin() then raise exception 'Admin access required'; end if;
  new.version := old.version+1; new.updated_at:=now();
  insert into public.website_settings_history(actor_id,version,previous_content,content) values(auth.uid(),new.version,old.content,new.content);
  return new;
end $$;
revoke all on function private.audit_website_settings() from public,anon,authenticated;
create trigger website_settings_audit before update on public.website_settings for each row execute function private.audit_website_settings();
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('website-images','website-images',true,5242880,array['image/jpeg','image/png','image/webp']);
create policy website_images_admin_insert on storage.objects for insert to authenticated with check(bucket_id='website-images' and private.is_admin());
create policy website_images_admin_select on storage.objects for select to authenticated using(bucket_id='website-images' and private.is_admin());
-- Unique upload paths are immutable. No overwrite/delete policy: published and historical images remain usable.
