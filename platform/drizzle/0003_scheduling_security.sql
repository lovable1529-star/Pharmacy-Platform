-- Row-level security for the scheduling tables.
--
-- Adding a table without adding its policy is the classic way a multi-tenant
-- system springs a leak, so this ships alongside the tables rather than after.

alter table public.availability enable row level security;
alter table public.appointment  enable row level security;

drop policy if exists availability_tenant_isolation on public.availability;
create policy availability_tenant_isolation on public.availability
  for all
  to authenticated
  using (organisation_id = public.current_organisation_id())
  with check (organisation_id = public.current_organisation_id());

drop policy if exists appointment_tenant_isolation on public.appointment;
create policy appointment_tenant_isolation on public.appointment
  for all
  to authenticated
  using (organisation_id = public.current_organisation_id())
  with check (organisation_id = public.current_organisation_id());

-- An appointment is a clinical record once it exists. Cancel it, do not delete
-- it — a slot that silently disappears from history is a slot nobody can prove
-- was ever booked.
drop trigger if exists appointment_no_delete on public.appointment;
create trigger appointment_no_delete
  before delete on public.appointment
  for each row execute function public.reject_clinical_delete();
