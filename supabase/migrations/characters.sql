create table public.characters (
  id text not null,
  image_base64 text not null,
  image_mime_type text not null,
  image_file_name text null,
  constraint characters_pkey primary key (id)
) TABLESPACE pg_default;