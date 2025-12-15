create table if not exists daily_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  text text not null,
  completed boolean default false,
  priority text default 'low',
  category text,
  created_at timestamptz default now(),
  completed_at timestamptz,
  scheduled_date date default current_date
);

-- Index for efficient querying by user and date
create index if not exists idx_daily_tasks_user_date 
  on daily_tasks(user_id, scheduled_date);

comment on table daily_tasks is 'Stores daily tasks for users.';
comment on column daily_tasks.user_id is 'Identifies the user (e.g. VITE_USER_ID or browser fingerprint)';
