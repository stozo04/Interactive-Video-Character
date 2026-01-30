create table public.selfie_generation_history (
  id uuid not null default gen_random_uuid (),
  reference_image_id text not null,
  hairstyle text not null,
  outfit_style text not null,
  scene text not null,
  mood text null,
  is_old_photo boolean not null default false,
  reference_date timestamp with time zone null,
  selection_factors jsonb not null default '{}'::jsonb,
  generated_at timestamp with time zone not null default now(),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint selfie_generation_history_pkey primary key (id),
  constraint selfie_generation_history_hairstyle_check check (
    (
      hairstyle = any (
        array[
          'curly'::text,
          'straight'::text,
          'messy_bun'::text,
          'waves'::text,
          'ponytail'::text,
          'headband'::text,
          'claw_clip'::text,
          'half_up'::text,
          'heatless_curls'::text,
          'dutch_braid'::text,
          'styled_bun'::text
        ]
      )
    )
  ),
  constraint selfie_generation_history_outfit_style_check check (
    (
      outfit_style = any (
        array[
          'casual'::text,
          'dressed_up'::text,
          'athletic'::text,
          'cozy'::text
        ]
      )
    )
  )
) TABLESPACE pg_default;

create index IF not exists idx_selfie_history_reference on public.selfie_generation_history using btree (reference_image_id, generated_at desc) TABLESPACE pg_default;

create trigger trigger_selfie_history_updated_at BEFORE
update on selfie_generation_history for EACH row
execute FUNCTION update_updated_at_column ();