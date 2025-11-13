<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1LmtG-2ZBmNS1apPZ-Ac80AgXcHAPEB6t

## Run Locally

**Prerequisites:**  Node.js and a Supabase project


1. Install dependencies:
   `npm install`
2. Create a `.env.local` file with the following values:
   ```
   NEXT_PUBLIC_SUPABASE_URL=your-supabase-url
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key
   ```
3. Run the app:
   `npm run dev`

## Supabase Schema Setup

1. Create three storage buckets:
   - `character-videos` – stores the character idle video files
   - `character-action-videos` – stores short clips for each character action
   - `video-cache` – caches legacy generated assets (optional)
2. Create a table named `characters` with the following columns:
   - `id` (text, primary key)
   - `created_at_ms` (bigint)
   - `image_base64` (text)
   - `image_mime_type` (text)
   - `image_file_name` (text, nullable)
   - `idle_video_path` (text)
   ```sql
   create table public.characters (
     id text primary key,
     created_at_ms bigint,
     image_base64 text not null,
     image_mime_type text not null,
     image_file_name text,
     idle_video_path text not null
   );
   ```
3. Create a table named `character_actions` to describe each saved action:
   ```sql
   create table public.character_actions (
     id text primary key,
     character_id text not null references public.characters(id) on delete cascade,
     action_key text unique,
     display_name text,
     video_path text not null,
     command_phrases text[],
     sort_order int,
     created_at timestamptz default now()
   );
   ```

Ensure the client that uses the anon key has `select`, `insert`, `update`, and `delete` privileges on the `characters` table and `read`/`write` access to both storage buckets.

### Populating Action Videos

1. Upload each action clip to the `character-action-videos` bucket. Recommended path format:
   ```
   <character_id>/actions/<action_id>.webm
   ```
2. Insert a row into `character_actions` for every action, setting `video_path` to the object path created above and `command_phrases` to the list of trigger phrases. Example:
   ```sql
   insert into public.character_actions (
     id,
     character_id,
     action_key,
     display_name,
     video_path,
     command_phrases,
     sort_order
   )
   values (
     'wave',
     'hero-123',
     'wave',
     'Wave',
     'hero-123/actions/wave.webm',
     array['wave', 'wave to the camera'],
     1
   );
   ```

Once the table rows and storage objects are in place, the app will automatically load the actions and make them available from the in-app Action Manager.
