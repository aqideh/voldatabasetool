begin;

create index if not exists maklom_profile_reconciliation_batches_created_by_idx
  on public.maklom_profile_reconciliation_batches(created_by)
  where created_by is not null;

create index if not exists maklom_profile_reconciliation_rows_maklom_volunteer_idx
  on public.maklom_profile_reconciliation_rows(maklom_volunteer_id);

create index if not exists maklom_profile_reconciliation_rows_confirmed_by_idx
  on public.maklom_profile_reconciliation_rows(confirmed_by)
  where confirmed_by is not null;

create index if not exists maklom_profile_reconciliation_changes_reviewed_by_idx
  on public.maklom_profile_reconciliation_changes(reviewed_by)
  where reviewed_by is not null;

commit;
