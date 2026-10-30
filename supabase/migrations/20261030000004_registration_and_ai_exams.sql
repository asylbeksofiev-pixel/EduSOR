-- EduSOR migration 0004: Class join codes, self-service school/student onboarding RPCs,
-- and standalone Gemini AI СОР/СОЧ exam paper check history.

alter table public.classes
  add column if not exists join_code text unique default upper(substr(md5(gen_random_uuid()::text), 1, 6));

update public.classes
   set join_code = upper(substr(md5(id::text), 1, 6))
 where join_code is null;

alter table public.classes
  alter column join_code set not null;

-- ---------------------------------------------------------------------------
-- Standalone / batch Gemini AI СОР & СОЧ checks
-- ---------------------------------------------------------------------------
create table if not exists public.ai_exam_checks (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  teacher_id uuid not null references public.profiles (id) on delete cascade,
  assessment_id uuid references public.assessments (id) on delete set null,
  student_name text check (char_length(student_name) <= 200),
  kind public.assessment_kind not null default 'sor',
  subject text check (char_length(subject) <= 120),
  grade smallint check (grade between 0 and 12),
  title text not null check (char_length(title) between 1 and 200),
  source_text text not null,
  rubric_text text,
  total_score numeric(8, 2) not null check (total_score >= 0),
  max_score numeric(8, 2) not null check (max_score > 0),
  percent numeric(5, 2) not null check (percent between 0 and 100),
  mark smallint not null check (mark between 2 and 5),
  summary text not null,
  feedback text not null,
  tasks jsonb not null default '[]'::jsonb,
  model text,
  created_at timestamptz not null default now()
);
create index if not exists ai_exam_checks_teacher_idx on public.ai_exam_checks (teacher_id, created_at desc);
create index if not exists ai_exam_checks_school_idx on public.ai_exam_checks (school_id, created_at desc);

alter table public.ai_exam_checks enable row level security;

create policy ai_exam_checks_select on public.ai_exam_checks for select to authenticated
  using (teacher_id = auth.uid() or public.is_school_admin(school_id) or public.is_super_admin());

create policy ai_exam_checks_insert on public.ai_exam_checks for insert to authenticated
  with check (teacher_id = auth.uid() and public.is_school_staff(school_id));

create policy ai_exam_checks_delete on public.ai_exam_checks for delete to authenticated
  using (teacher_id = auth.uid() or public.is_school_admin(school_id));

-- ---------------------------------------------------------------------------
-- Self-service School Creation during Registration / Onboarding
-- ---------------------------------------------------------------------------
create or replace function public.create_school_with_admin(
  p_name text,
  p_city text default null,
  p_region text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_school uuid;
  v_year uuid;
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if char_length(trim(coalesce(p_name, ''))) < 2 then raise exception 'invalid' using errcode = '22023'; end if;

  insert into public.schools (name, city, region)
  values (trim(p_name), nullif(trim(coalesce(p_city, '')), ''), nullif(trim(coalesce(p_region, p_city, '')), ''))
  returning id into v_school;

  insert into public.school_memberships (school_id, user_id, role, status)
  values
    (v_school, auth.uid(), 'school_admin', 'active'),
    (v_school, auth.uid(), 'teacher', 'active')
  on conflict (school_id, user_id, role) do update set status = 'active';

  insert into public.academic_years (school_id, name, starts_on, ends_on, is_current)
  values (v_school, '2026–2027', '2026-09-01', '2027-05-25', true)
  returning id into v_year;

  insert into public.subjects (school_id, name_ru, name_kk, code) values
    (v_school, 'Математика', 'Математика', 'MATH'),
    (v_school, 'Алгебра', 'Алгебра', 'ALG'),
    (v_school, 'Физика', 'Физика', 'PHYS'),
    (v_school, 'Информатика', 'Информатика', 'INF'),
    (v_school, 'Казахский язык и литература', 'Қазақ тілі мен әдебиеті', 'KAZ'),
    (v_school, 'Русский язык и литература', 'Орыс тілі мен әдебиеті', 'RUS'),
    (v_school, 'Английский язык', 'Ағылшын тілі', 'ENG'),
    (v_school, 'История Казахстана', 'Қазақстан тарихы', 'HIST'),
    (v_school, 'Биология', 'Биология', 'BIO'),
    (v_school, 'Химия', 'Химия', 'CHEM')
  on conflict do nothing;

  return v_school;
end $$;

-- ---------------------------------------------------------------------------
-- Student enrollment by Class Join Code
-- ---------------------------------------------------------------------------
create or replace function public.join_class_by_code(p_join_code text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_class public.classes;
  v_school public.schools;
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select * into v_class from public.classes where join_code = upper(trim(coalesce(p_join_code, '')));
  if not found then raise exception 'class_not_found' using errcode = 'P0002'; end if;
  select * into v_school from public.schools where id = v_class.school_id and is_active;
  if not found then raise exception 'school_not_found' using errcode = 'P0002'; end if;

  insert into public.school_memberships (school_id, user_id, role, status)
  values (v_class.school_id, auth.uid(), 'student', 'active')
  on conflict (school_id, user_id, role) do update set status = 'active';

  insert into public.class_enrollments (class_id, student_id)
  values (v_class.id, auth.uid())
  on conflict (class_id, student_id) do nothing;

  return v_class.id;
end $$;

revoke execute on function public.create_school_with_admin(text, text, text) from anon;
revoke execute on function public.join_class_by_code(text) from anon;
