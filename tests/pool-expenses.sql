begin;
insert into auth.users(id,email) values
('00000000-0000-4000-a000-000000009081','pool-expense-test@example.invalid'),
('00000000-0000-4000-a000-000000009082','other-expense-test@example.invalid');
insert into public.staff(id,full_name,role,active) values
('00000000-0000-4000-a000-000000009081','Pool expense test','pool_manager',true),
('00000000-0000-4000-a000-000000009082','Other expense test','manager',true);
insert into public.expenses(id,expense_date,category,amount,description,facility_id,created_by)
values ('00000000-0000-4000-a000-000000009083',current_date,'other',10,'Other person','pool','00000000-0000-4000-a000-000000009082');
select set_config('request.jwt.claim.sub','00000000-0000-4000-a000-000000009081',true);
set local role authenticated;
do $$ declare eid uuid; n integer; denied boolean; begin
  if exists(select 1 from public.expenses) then raise exception 'Other expenses exposed'; end if;
  insert into public.expenses(expense_date,category,amount,description,facility_id,created_by)
  values(current_date,'supplies',100,'Own expense','pool',auth.uid()) returning id into eid;
  update public.expenses set amount=125,description='Edited' where id=eid;
  if not exists(select 1 from public.expenses where id=eid and amount=125 and description='Edited') then raise exception 'Own edit failed'; end if;
  insert into public.audit_log(actor_id,action,table_name,record_id,details) values(auth.uid(),'edit_expense','expenses',eid::text,'{}');
  update public.expenses set amount=1 where id='00000000-0000-4000-a000-000000009083';
  get diagnostics n=row_count; if n<>0 then raise exception 'Other expense editable'; end if;
  denied:=false; begin update public.expenses set facility_id='ac_hall' where id=eid; exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'Facility reassignment allowed'; end if;
  denied:=false; begin update public.expenses set created_by='00000000-0000-4000-a000-000000009082' where id=eid; exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'Owner reassignment allowed'; end if;
  denied:=false; begin insert into public.expenses(expense_date,category,amount,description,facility_id,created_by) values(current_date,'other',1,'Forbidden','pool','00000000-0000-4000-a000-000000009082'); exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'Spoofed creator allowed'; end if;
  delete from public.expenses where id=eid;
  get diagnostics n=row_count; if n<>0 then raise exception 'Pool manager deletion allowed'; end if;
end $$;
reset role;
update public.staff set active=false where id='00000000-0000-4000-a000-000000009081';
set local role authenticated;
do $$ begin if exists(select 1 from public.expenses) then raise exception 'Inactive user access retained'; end if; end $$;
reset role;
rollback;
select 'PASS: own expense create/read/edit/audit; other owners, reassignment, deletion and inactive access denied; fixtures rolled back' as result;
