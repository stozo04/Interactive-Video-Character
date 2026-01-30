-- ============================================
-- Holidays Table
-- ============================================
-- Stores major holidays with their dates for the current year.
-- Dates should be updated annually (some holidays move each year).
--
-- Usage: Query for today's holiday, upcoming holidays, or passed holidays
-- for greeting context and follow-up questions.

CREATE TABLE IF NOT EXISTS holidays (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  month INTEGER NOT NULL CHECK (month >= 1 AND month <= 12),
  day INTEGER NOT NULL CHECK (day >= 1 AND day <= 31),
  year INTEGER NOT NULL, -- The year this date applies to
  greeting TEXT, -- Optional greeting text (e.g., "Merry Christmas!")
  follow_up_question TEXT, -- Question to ask if holiday passed (e.g., "How was Christmas?")
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for quick date lookups
CREATE INDEX idx_holidays_date ON holidays (year, month, day);
CREATE INDEX idx_holidays_month_day ON holidays (month, day);

-- Unique constraint: one entry per holiday per year
CREATE UNIQUE INDEX idx_holidays_unique ON holidays (name, year);

-- ============================================
-- Seed data for 2025
-- ============================================
-- Fixed holidays (same date every year)
INSERT INTO holidays (name, month, day, year, greeting, follow_up_question) VALUES
  ('New Year''s Day', 1, 1, 2025, 'Happy New Year!', 'How was New Year''s? Do anything fun?'),
  ('Valentine''s Day', 2, 14, 2025, 'Happy Valentine''s Day!', 'How was Valentine''s Day?'),
  ('St. Patrick''s Day', 3, 17, 2025, 'Happy St. Patrick''s Day!', 'Did you do anything for St. Patrick''s Day?'),
  ('Independence Day', 7, 4, 2025, 'Happy 4th of July!', 'How was the 4th? See any fireworks?'),
  ('Halloween', 10, 31, 2025, 'Happy Halloween!', 'How was Halloween? Do anything spooky?'),
  ('Christmas Eve', 12, 24, 2025, 'Merry Christmas Eve!', 'How was Christmas Eve?'),
  ('Christmas', 12, 25, 2025, 'Merry Christmas!', 'How was Christmas?'),
  ('New Year''s Eve', 12, 31, 2025, 'Happy New Year''s Eve!', 'How was New Year''s Eve?');

-- Variable holidays for 2025 (these change each year!)
-- Easter: April 20, 2025
INSERT INTO holidays (name, month, day, year, greeting, follow_up_question) VALUES
  ('Easter', 4, 20, 2025, 'Happy Easter!', 'How was Easter?');

-- Mother's Day: 2nd Sunday in May = May 11, 2025
INSERT INTO holidays (name, month, day, year, greeting, follow_up_question) VALUES
  ('Mother''s Day', 5, 11, 2025, 'Happy Mother''s Day!', 'Did you do anything nice for Mother''s Day?');

-- Memorial Day: Last Monday in May = May 26, 2025
INSERT INTO holidays (name, month, day, year, greeting, follow_up_question) VALUES
  ('Memorial Day', 5, 26, 2025, NULL, 'How was your Memorial Day weekend?');

-- Father's Day: 3rd Sunday in June = June 15, 2025
INSERT INTO holidays (name, month, day, year, greeting, follow_up_question) VALUES
  ('Father''s Day', 6, 15, 2025, 'Happy Father''s Day!', 'Did you do anything for Father''s Day?');

-- Labor Day: 1st Monday in September = September 1, 2025
INSERT INTO holidays (name, month, day, year, greeting, follow_up_question) VALUES
  ('Labor Day', 9, 1, 2025, NULL, 'How was your Labor Day weekend?');

-- Thanksgiving: 4th Thursday in November = November 27, 2025
INSERT INTO holidays (name, month, day, year, greeting, follow_up_question) VALUES
  ('Thanksgiving', 11, 27, 2025, 'Happy Thanksgiving!', 'How was Thanksgiving? Good food?');

-- ============================================
-- Seed data for 2026
-- ============================================
-- Fixed holidays (same date every year)
INSERT INTO holidays (name, month, day, year, greeting, follow_up_question) VALUES
  ('New Year''s Day', 1, 1, 2026, 'Happy New Year!', 'How was New Year''s? Do anything fun?'),
  ('Valentine''s Day', 2, 14, 2026, 'Happy Valentine''s Day!', 'How was Valentine''s Day?'),
  ('St. Patrick''s Day', 3, 17, 2026, 'Happy St. Patrick''s Day!', 'Did you do anything for St. Patrick''s Day?'),
  ('Independence Day', 7, 4, 2026, 'Happy 4th of July!', 'How was the 4th? See any fireworks?'),
  ('Halloween', 10, 31, 2026, 'Happy Halloween!', 'How was Halloween? Do anything spooky?'),
  ('Christmas Eve', 12, 24, 2026, 'Merry Christmas Eve!', 'How was Christmas Eve?'),
  ('Christmas', 12, 25, 2026, 'Merry Christmas!', 'How was Christmas?'),
  ('New Year''s Eve', 12, 31, 2026, 'Happy New Year''s Eve!', 'How was New Year''s Eve?');

-- Variable holidays for 2026 (these change each year!)
-- Easter: April 5, 2026
INSERT INTO holidays (name, month, day, year, greeting, follow_up_question) VALUES
  ('Easter', 4, 5, 2026, 'Happy Easter!', 'How was Easter?');

-- Mother's Day: 2nd Sunday in May = May 10, 2026
INSERT INTO holidays (name, month, day, year, greeting, follow_up_question) VALUES
  ('Mother''s Day', 5, 10, 2026, 'Happy Mother''s Day!', 'Did you do anything nice for Mother''s Day?');

-- Memorial Day: Last Monday in May = May 25, 2026
INSERT INTO holidays (name, month, day, year, greeting, follow_up_question) VALUES
  ('Memorial Day', 5, 25, 2026, NULL, 'How was your Memorial Day weekend?');

-- Father's Day: 3rd Sunday in June = June 21, 2026
INSERT INTO holidays (name, month, day, year, greeting, follow_up_question) VALUES
  ('Father''s Day', 6, 21, 2026, 'Happy Father''s Day!', 'Did you do anything for Father''s Day?');

-- Labor Day: 1st Monday in September = September 7, 2026
INSERT INTO holidays (name, month, day, year, greeting, follow_up_question) VALUES
  ('Labor Day', 9, 7, 2026, NULL, 'How was your Labor Day weekend?');

-- Thanksgiving: 4th Thursday in November = November 26, 2026
INSERT INTO holidays (name, month, day, year, greeting, follow_up_question) VALUES
  ('Thanksgiving', 11, 26, 2026, 'Happy Thanksgiving!', 'How was Thanksgiving? Good food?');

-- ============================================
-- Helper comment for future updates
-- ============================================
-- YEARLY UPDATE REMINDER:
-- Variable holidays to update each year:
-- - Easter: Changes every year (March/April)
-- - Mother's Day: 2nd Sunday in May
-- - Memorial Day: Last Monday in May
-- - Father's Day: 3rd Sunday in June
-- - Labor Day: 1st Monday in September
-- - Thanksgiving: 4th Thursday in November
--
-- To add a new year, copy the INSERT statements and update:
-- 1. The year value
-- 2. The dates for variable holidays
