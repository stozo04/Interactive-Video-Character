create table public.character_actions (
  id text not null,
  character_id text not null,
  action_key text null,
  display_name text null,
  video_path text not null,
  command_phrases text[] null,
  sort_order integer null,
  created_at timestamp with time zone null default now(),
  constraint character_actions_pkey primary key (id),
  constraint character_actions_action_key_key unique (action_key),
  constraint character_actions_character_id_fkey foreign KEY (character_id) references characters (id) on delete CASCADE
) TABLESPACE pg_default;