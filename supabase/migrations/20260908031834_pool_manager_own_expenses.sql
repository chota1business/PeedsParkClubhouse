-- Pool managers may manage only expenses they created for the pool.
create policy pool_manager_expenses_select on public.expenses for select to authenticated
using (private.current_staff_role() = 'pool_manager' and facility_id = 'pool' and created_by = auth.uid());
create policy pool_manager_expenses_insert on public.expenses for insert to authenticated
with check (private.current_staff_role() = 'pool_manager' and facility_id = 'pool' and created_by = auth.uid());
create policy pool_manager_expenses_update on public.expenses for update to authenticated
using (private.current_staff_role() = 'pool_manager' and facility_id = 'pool' and created_by = auth.uid())
with check (private.current_staff_role() = 'pool_manager' and facility_id = 'pool' and created_by = auth.uid());
create policy pool_manager_expense_audit_insert on public.audit_log for insert to authenticated
with check (actor_id = auth.uid() and private.current_staff_role() = 'pool_manager'
  and table_name = 'expenses' and action in ('log_expense','edit_expense')
  and exists (select 1 from public.expenses e where e.id::text = record_id and e.created_by = auth.uid() and e.facility_id = 'pool'));
