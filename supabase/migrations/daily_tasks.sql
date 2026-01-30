create table public.daily_tasks (
  id uuid not null default gen_random_uuid (),
  text text not null,
  completed boolean null default false,
  priority text null default 'low'::text,
  category text null,
  created_at timestamp with time zone null default now(),
  completed_at timestamp with time zone null,
  scheduled_date date null default CURRENT_DATE,
  constraint daily_tasks_pkey primary key (id)
) TABLESPACE pg_default;