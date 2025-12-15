-- Fix daily_tasks.user_id type to support email addresses
ALTER TABLE daily_tasks ALTER COLUMN user_id TYPE text;
