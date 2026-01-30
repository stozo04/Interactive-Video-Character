create table public.promises (
  promise_type text not null,
  description text not null,
  trigger_event text not null,
  estimated_timing timestamp with time zone not null,
  commitment_context text null,
  fulfillment_data jsonb null default '{}'::jsonb,
  status text not null default 'pending'::text,
  created_at timestamp with time zone not null default now(),
  fulfilled_at timestamp with time zone null,
  id uuid not null default gen_random_uuid (),
  constraint promises_pkey primary key (id),
  constraint promises_status_check check (
    (
      status = any (
        array[
          'pending'::text,
          'fulfilled'::text,
          'missed'::text,
          'cancelled'::text
        ]
      )
    )
  )
) TABLESPACE pg_default;

create index IF not exists idx_promises_status on public.promises using btree (status) TABLESPACE pg_default;

create index IF not exists idx_promises_timing on public.promises using btree (estimated_timing) TABLESPACE pg_default
where
  (status = 'pending'::text);

create index IF not exists idx_promises_ready on public.promises using btree (estimated_timing) TABLESPACE pg_default
where
  (status = 'pending'::text);

create trigger trg_promises_after_insert_queue_if_due
after INSERT on promises for EACH row
execute FUNCTION promises_after_insert_queue_if_due ();

create trigger trg_promises_after_update_queue_on_fulfill
after
update on promises for EACH row
execute FUNCTION promises_after_update_queue_on_fulfill ();