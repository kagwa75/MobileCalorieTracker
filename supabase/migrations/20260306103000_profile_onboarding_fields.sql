ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS age INT,
ADD COLUMN IF NOT EXISTS weight_kg NUMERIC(6, 2),
ADD COLUMN IF NOT EXISTS height_cm NUMERIC(6, 2),
ADD COLUMN IF NOT EXISTS gender TEXT,
ADD COLUMN IF NOT EXISTS activity_level TEXT,
ADD COLUMN IF NOT EXISTS goal TEXT,
ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMP WITH TIME ZONE;

ALTER TABLE public.profiles
DROP CONSTRAINT IF EXISTS profiles_age_check,
DROP CONSTRAINT IF EXISTS profiles_weight_kg_check,
DROP CONSTRAINT IF EXISTS profiles_height_cm_check,
DROP CONSTRAINT IF EXISTS profiles_gender_check,
DROP CONSTRAINT IF EXISTS profiles_activity_level_check,
DROP CONSTRAINT IF EXISTS profiles_goal_check;

ALTER TABLE public.profiles
ADD CONSTRAINT profiles_age_check CHECK (age IS NULL OR age BETWEEN 13 AND 120),
ADD CONSTRAINT profiles_weight_kg_check CHECK (weight_kg IS NULL OR weight_kg BETWEEN 25 AND 400),
ADD CONSTRAINT profiles_height_cm_check CHECK (height_cm IS NULL OR height_cm BETWEEN 90 AND 250),
ADD CONSTRAINT profiles_gender_check CHECK (gender IS NULL OR gender IN ('male', 'female', 'non_binary')),
ADD CONSTRAINT profiles_activity_level_check CHECK (
  activity_level IS NULL OR activity_level IN ('sedentary', 'light', 'moderate', 'active', 'very_active')
),
ADD CONSTRAINT profiles_goal_check CHECK (goal IS NULL OR goal IN ('lose', 'maintain', 'gain'));
