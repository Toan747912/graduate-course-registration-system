-- 0031_trigger_advisor_deactivate_guard.sql
-- BUS-58 / BUS-64: an advisor cannot be moved from is_active=true to
-- is_active=false while any thesis referencing it is IN_PROGRESS. This is the
-- final, DB-level integrity guard -- independent of the RPC pre-check added
-- later in 0034 (staff_deactivate_advisor). It applies to every write path,
-- including direct SQL by the service role or a future script that bypasses
-- the RPC entirely. See docs/BATCH_4_THESIS_ADVISOR_DESIGN.md sections D.1,
-- D.5, H.4, and the "why not in 0029" note in section I: this trigger could
-- only be added after public.theses existed (0030), which is why it ships as
-- its own migration instead of alongside the advisors table.

create or replace function public.advisors_block_deactivate_when_in_progress()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if old.is_active = true and new.is_active = false then
    if exists (
      select 1
      from public.theses
      where advisor_id = old.id
        and status = 'IN_PROGRESS'
    ) then
      raise exception 'Không thể ngừng hoạt động giảng viên còn luận văn đang thực hiện (IN_PROGRESS).';
    end if;
  end if;
  return new;
end;
$$;

comment on function public.advisors_block_deactivate_when_in_progress() is 'BUS-58/BUS-64 final DB-level guard: blocks advisors.is_active true->false while any theses.status=IN_PROGRESS row references the advisor. Independent of the staff_deactivate_advisor RPC pre-check (0034); applies to every UPDATE path.';

-- Trigger function itself must not be directly callable/assignable by
-- clients outside of the trigger mechanism; revoke matches the internal
-- helper convention used elsewhere in this batch (0035/0036/0037).
revoke all on function public.advisors_block_deactivate_when_in_progress() from public;
revoke all on function public.advisors_block_deactivate_when_in_progress() from anon;
revoke all on function public.advisors_block_deactivate_when_in_progress() from authenticated;

create trigger advisors_block_deactivate_when_in_progress
  before update on public.advisors
  for each row
  execute function public.advisors_block_deactivate_when_in_progress();
