begin;
insert into auth.users(id,email) values('00000000-0000-4000-a000-000000009091','settings-test@example.invalid');
insert into public.staff(id,full_name,role,active) values('00000000-0000-4000-a000-000000009091','Settings test','manager',true);
select set_config('request.jwt.claim.sub','00000000-0000-4000-a000-000000009091',true);
set local role authenticated;
do $$ declare n integer; denied boolean:=false; begin
  update public.website_settings set content='{}' where id=1;
  get diagnostics n=row_count; if n<>0 then raise exception 'Manager changed settings'; end if;
  if exists(select 1 from public.website_settings_history) then raise exception 'Manager can read history'; end if;
  begin insert into storage.objects(bucket_id,name) values('website-images','test-denied.webp');exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'Manager upload allowed';end if;
end $$;
reset role;
update public.staff set role='pool_manager' where id='00000000-0000-4000-a000-000000009091';
set local role authenticated;
do $$ declare n integer; begin
  update public.website_settings set content='{}' where id=1;get diagnostics n=row_count;if n<>0 then raise exception 'Pool manager changed settings';end if;
end $$;
reset role;
update public.staff set role='admin' where id='00000000-0000-4000-a000-000000009091';
set local role authenticated;
do $$ declare v integer; n integer; begin
  select version into v from public.website_settings where id=1;
  update public.website_settings set content='{"test":true}' where id=1 and version=v;
  if not exists(select 1 from public.website_settings where id=1 and version=v+1) then raise exception 'Publish version not advanced';end if;
  if not exists(select 1 from public.website_settings_history where version=v+1 and actor_id=auth.uid() and content='{"test":true}') then raise exception 'Audit missing';end if;
  update public.website_settings set content='{}' where id=1 and version=v;get diagnostics n=row_count;if n<>0 then raise exception 'Stale write succeeded';end if;
  insert into storage.objects(bucket_id,name) values('website-images','test-admin.webp');
end $$;
reset role;
update public.staff set active=false where id='00000000-0000-4000-a000-000000009091';
set local role authenticated;
do $$ declare n integer;begin update public.website_settings set content='{}' where id=1;get diagnostics n=row_count;if n<>0 then raise exception 'Inactive admin retained access';end if;end $$;
reset role;
set local role anon;
do $$ declare denied boolean:=false;begin
  if not exists(select 1 from public.website_settings where id=1) then raise exception 'Public settings unavailable';end if;
  begin update public.website_settings set content='{}' where id=1;exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'Anonymous mutation allowed';end if;
end $$;
reset role;
rollback;
select 'PASS: public read only; admin publish/upload/audit/version; manager, pool manager and inactive admin denied; all fixtures rolled back' as result;
