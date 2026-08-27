-- ═══════════════════════════════════════════════════════════
-- 07 · Appointments and opening hours
-- Karsons Pharmacy platform
-- ═══════════════════════════════════════════════════════════
-- Adds the two scheduling tables and their security policies.
-- 
-- Run this AFTER 01 and 02. If you have already run 03, re-run 03 afterwards
-- as well — it now seeds default opening hours, and those rows need these
-- tables to exist first.
-- 
-- Availability is stored as recurring windows rather than materialised slots,
-- so changing opening hours never means regenerating a table.
CREATE TYPE "public"."appointment_status" AS ENUM('BOOKED', 'ARRIVED', 'COMPLETED', 'CANCELLED', 'DID_NOT_ATTEND');

CREATE TABLE "appointment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"patient_id" uuid,
	"submission_id" uuid,
	"consultation_id" uuid,
	"status" "appointment_status" DEFAULT 'BOOKED' NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"booked_name" text NOT NULL,
	"booked_email" text,
	"booked_phone" text,
	"reference" text NOT NULL,
	"notes" text,
	"cancelled_at" timestamp with time zone,
	"cancellation_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);


CREATE TABLE "availability" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"service_id" uuid,
	"weekday" integer NOT NULL,
	"start_minute" integer NOT NULL,
	"end_minute" integer NOT NULL,
	"slot_minutes" integer DEFAULT 15 NOT NULL,
	"capacity" integer DEFAULT 1 NOT NULL,
	"effective_from" date,
	"effective_to" date,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE "appointment" ADD CONSTRAINT "appointment_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "appointment" ADD CONSTRAINT "appointment_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "appointment" ADD CONSTRAINT "appointment_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "appointment" ADD CONSTRAINT "appointment_service_id_service_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."service"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "appointment" ADD CONSTRAINT "appointment_patient_id_patient_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patient"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "appointment" ADD CONSTRAINT "appointment_submission_id_submission_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submission"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "appointment" ADD CONSTRAINT "appointment_consultation_id_consultation_id_fk" FOREIGN KEY ("consultation_id") REFERENCES "public"."consultation"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "availability" ADD CONSTRAINT "availability_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "availability" ADD CONSTRAINT "availability_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "availability" ADD CONSTRAINT "availability_service_id_service_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."service"("id") ON DELETE no action ON UPDATE no action;

CREATE INDEX "appointment_branch_start_idx" ON "appointment" USING btree ("branch_id","starts_at");

CREATE INDEX "appointment_org_idx" ON "appointment" USING btree ("organisation_id","starts_at");

CREATE UNIQUE INDEX "appointment_reference_idx" ON "appointment" USING btree ("organisation_id","reference");

CREATE INDEX "availability_branch_idx" ON "availability" USING btree ("branch_id","weekday");

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


-- Default opening hours ───────────────────────────────────
-- Monday to Friday all day, Saturday mornings. A null service_id means the
-- window is open to every service — his GLP-1 document requires repeat-care
-- appointments to share the vaccination calendar.
--
-- These are a starting point the client changes in Settings, not a guess he
-- is stuck with. Slots are generated from these on demand, so editing hours
-- never means regenerating anything.
insert into availability (id, organisation_id, branch_id, service_id, weekday, start_minute, end_minute, slot_minutes, capacity) values
  ('49932a69-3ed8-560c-9be1-bad6257dadbb', 'e91b8b9a-54e8-55a1-8412-d3ade3da0b53', '2e9d53ca-ce0a-50a3-9ad0-e639a45741b2', null, 1, 540, 1020, 15, 1),
  ('58c0e65a-b5b5-5373-9951-4c9c61af0ace', 'e91b8b9a-54e8-55a1-8412-d3ade3da0b53', '2e9d53ca-ce0a-50a3-9ad0-e639a45741b2', null, 2, 540, 1020, 15, 1),
  ('576df46f-a82d-5cd7-b52c-f5621a66807c', 'e91b8b9a-54e8-55a1-8412-d3ade3da0b53', '2e9d53ca-ce0a-50a3-9ad0-e639a45741b2', null, 3, 540, 1020, 15, 1),
  ('082c20d9-68d8-5c22-967f-c8d8039aece9', 'e91b8b9a-54e8-55a1-8412-d3ade3da0b53', '2e9d53ca-ce0a-50a3-9ad0-e639a45741b2', null, 4, 540, 1020, 15, 1),
  ('783dea60-c163-55a6-adae-3f4c08ea5bca', 'e91b8b9a-54e8-55a1-8412-d3ade3da0b53', '2e9d53ca-ce0a-50a3-9ad0-e639a45741b2', null, 5, 540, 1020, 15, 1),
  ('eb521ce4-4bbe-5e33-8eb0-765852c39cf0', 'e91b8b9a-54e8-55a1-8412-d3ade3da0b53', '2e9d53ca-ce0a-50a3-9ad0-e639a45741b2', null, 6, 540, 780, 15, 1),
  ('04c3581a-3962-55d0-898b-44f438757b70', 'e91b8b9a-54e8-55a1-8412-d3ade3da0b53', '91d6d112-e3c0-5676-8b3c-029428a17e97', null, 1, 540, 1020, 15, 1),
  ('88a29c3f-f279-5a45-81e1-4770e99699c1', 'e91b8b9a-54e8-55a1-8412-d3ade3da0b53', '91d6d112-e3c0-5676-8b3c-029428a17e97', null, 2, 540, 1020, 15, 1),
  ('4245381e-92fb-5abe-8d51-5e3a6c52df70', 'e91b8b9a-54e8-55a1-8412-d3ade3da0b53', '91d6d112-e3c0-5676-8b3c-029428a17e97', null, 3, 540, 1020, 15, 1),
  ('592af07c-52ac-575d-ac0e-132b0b2db612', 'e91b8b9a-54e8-55a1-8412-d3ade3da0b53', '91d6d112-e3c0-5676-8b3c-029428a17e97', null, 4, 540, 1020, 15, 1),
  ('6159a139-de69-54ae-b5ee-7d6b3f6908c6', 'e91b8b9a-54e8-55a1-8412-d3ade3da0b53', '91d6d112-e3c0-5676-8b3c-029428a17e97', null, 5, 540, 1020, 15, 1),
  ('f290a99b-34c1-5a82-ba41-8d6ae6166f37', 'e91b8b9a-54e8-55a1-8412-d3ade3da0b53', '91d6d112-e3c0-5676-8b3c-029428a17e97', null, 6, 540, 780, 15, 1)
on conflict (id) do nothing;
