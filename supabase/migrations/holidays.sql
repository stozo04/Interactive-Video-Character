create table public.holidays (
  id uuid not null default gen_random_uuid (),
  name text not null,
  month integer not null,
  day integer not null,
  year integer not null,
  greeting text null,
  created_at timestamp with time zone null default now(),
  updated_at timestamp with time zone null default now(),
  constraint holidays_pkey primary key (id),
  constraint holidays_day_check check (
    (
      (day >= 1)
      and (day <= 31)
    )
  ),
  constraint holidays_month_check check (
    (
      (month >= 1)
      and (month <= 12)
    )
  )
) TABLESPACE pg_default;

create index IF not exists idx_holidays_date on public.holidays using btree (year, month, day) TABLESPACE pg_default;

create index IF not exists idx_holidays_month_day on public.holidays using btree (month, day) TABLESPACE pg_default;

create unique INDEX IF not exists idx_holidays_unique on public.holidays using btree (name, year) TABLESPACE pg_default;