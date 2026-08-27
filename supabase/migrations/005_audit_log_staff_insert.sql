-- Phase 2: let staff write their own audit trail entries directly (safe because
-- there is still no UPDATE/DELETE policy for staff on audit_log — entries are
-- write-once from the client's perspective, tamper-proof after the fact).
create policy audit_log_staff_insert on audit_log for insert
  with check (private.is_staff() and actor_id = auth.uid());
