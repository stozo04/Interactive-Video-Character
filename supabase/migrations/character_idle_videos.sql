create table public.character_idle_videos (
  id uuid not null default gen_random_uuid (),
  character_id text not null,
  video_path text not null,
  constraint character_idle_videos_pkey primary key (id),
  constraint character_idle_videos_character_id_fkey foreign KEY (character_id) references characters (id) on delete CASCADE
) TABLESPACE pg_default;