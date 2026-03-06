ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS target_pace TEXT,
ADD COLUMN IF NOT EXISTS dietary_preference TEXT,
ADD COLUMN IF NOT EXISTS timezone_name TEXT,
ADD COLUMN IF NOT EXISTS adaptive_calorie_target_enabled BOOLEAN,
ADD COLUMN IF NOT EXISTS baseline_calorie_goal INT,
ADD COLUMN IF NOT EXISTS target_weight_kg NUMERIC(6, 2),
ADD COLUMN IF NOT EXISTS last_target_recalculated_on DATE;

UPDATE public.profiles
SET
  target_pace = COALESCE(target_pace, 'medium'),
  dietary_preference = COALESCE(dietary_preference, 'balanced'),
  timezone_name = COALESCE(timezone_name, 'UTC'),
  adaptive_calorie_target_enabled = COALESCE(adaptive_calorie_target_enabled, TRUE),
  baseline_calorie_goal = COALESCE(baseline_calorie_goal, daily_calorie_goal),
  target_weight_kg = COALESCE(target_weight_kg, weight_kg)
WHERE
  target_pace IS NULL
  OR dietary_preference IS NULL
  OR timezone_name IS NULL
  OR adaptive_calorie_target_enabled IS NULL
  OR baseline_calorie_goal IS NULL
  OR target_weight_kg IS NULL;

ALTER TABLE public.profiles
ALTER COLUMN target_pace SET DEFAULT 'medium',
ALTER COLUMN dietary_preference SET DEFAULT 'balanced',
ALTER COLUMN timezone_name SET DEFAULT 'UTC',
ALTER COLUMN adaptive_calorie_target_enabled SET DEFAULT TRUE;

ALTER TABLE public.profiles
ALTER COLUMN target_pace SET NOT NULL,
ALTER COLUMN dietary_preference SET NOT NULL,
ALTER COLUMN timezone_name SET NOT NULL,
ALTER COLUMN adaptive_calorie_target_enabled SET NOT NULL;

ALTER TABLE public.profiles
DROP CONSTRAINT IF EXISTS profiles_target_pace_check,
DROP CONSTRAINT IF EXISTS profiles_dietary_preference_check,
DROP CONSTRAINT IF EXISTS profiles_timezone_name_length_check,
DROP CONSTRAINT IF EXISTS profiles_baseline_calorie_goal_check,
DROP CONSTRAINT IF EXISTS profiles_target_weight_kg_check;

ALTER TABLE public.profiles
ADD CONSTRAINT profiles_target_pace_check CHECK (target_pace IN ('slow', 'medium', 'aggressive')),
ADD CONSTRAINT profiles_dietary_preference_check CHECK (
  dietary_preference IN ('balanced', 'high_protein', 'low_carb', 'vegetarian', 'vegan')
),
ADD CONSTRAINT profiles_timezone_name_length_check CHECK (char_length(timezone_name) BETWEEN 3 AND 80),
ADD CONSTRAINT profiles_baseline_calorie_goal_check CHECK (baseline_calorie_goal IS NULL OR baseline_calorie_goal BETWEEN 1200 AND 4500),
ADD CONSTRAINT profiles_target_weight_kg_check CHECK (target_weight_kg IS NULL OR target_weight_kg BETWEEN 25 AND 400);

CREATE TABLE IF NOT EXISTS public.weight_checkins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  weight_kg NUMERIC(6, 2) NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  note TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT weight_checkins_weight_kg_check CHECK (weight_kg BETWEEN 25 AND 400),
  CONSTRAINT weight_checkins_source_check CHECK (source IN ('manual', 'import')),
  CONSTRAINT weight_checkins_note_length_check CHECK (note IS NULL OR char_length(note) <= 240),
  CONSTRAINT weight_checkins_user_date_unique UNIQUE (user_id, date)
);

ALTER TABLE public.weight_checkins ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own weight check-ins" ON public.weight_checkins
FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own weight check-ins" ON public.weight_checkins
FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own weight check-ins" ON public.weight_checkins
FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own weight check-ins" ON public.weight_checkins
FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER update_weight_checkins_updated_at
BEFORE UPDATE ON public.weight_checkins
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_weight_checkins_user_date ON public.weight_checkins (user_id, date DESC);

CREATE TABLE IF NOT EXISTS public.calorie_target_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  effective_date DATE NOT NULL DEFAULT CURRENT_DATE,
  previous_target INT NOT NULL,
  new_target INT NOT NULL,
  adjustment INT NOT NULL,
  reason TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT calorie_target_adjustments_reason_length_check CHECK (char_length(reason) BETWEEN 3 AND 120),
  CONSTRAINT calorie_target_adjustments_target_bounds_check CHECK (previous_target BETWEEN 1200 AND 4500 AND new_target BETWEEN 1200 AND 4500),
  CONSTRAINT calorie_target_adjustments_adjustment_bounds_check CHECK (adjustment BETWEEN -400 AND 400)
);

ALTER TABLE public.calorie_target_adjustments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own target adjustments" ON public.calorie_target_adjustments
FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own target adjustments" ON public.calorie_target_adjustments
FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_calorie_target_adjustments_user_effective_date
ON public.calorie_target_adjustments (user_id, effective_date DESC);

CREATE TABLE IF NOT EXISTS public.custom_foods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  brand TEXT,
  barcode TEXT,
  serving_size TEXT NOT NULL DEFAULT '1 serving',
  calories INT NOT NULL,
  protein NUMERIC(8, 2) NOT NULL,
  carbs NUMERIC(8, 2) NOT NULL,
  fat NUMERIC(8, 2) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  last_used_at TIMESTAMP WITH TIME ZONE,
  CONSTRAINT custom_foods_name_length_check CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  CONSTRAINT custom_foods_brand_length_check CHECK (brand IS NULL OR char_length(btrim(brand)) BETWEEN 1 AND 80),
  CONSTRAINT custom_foods_barcode_length_check CHECK (barcode IS NULL OR char_length(btrim(barcode)) BETWEEN 6 AND 24),
  CONSTRAINT custom_foods_serving_size_length_check CHECK (char_length(btrim(serving_size)) BETWEEN 1 AND 120),
  CONSTRAINT custom_foods_calories_check CHECK (calories BETWEEN 0 AND 5000),
  CONSTRAINT custom_foods_protein_check CHECK (protein BETWEEN 0 AND 500),
  CONSTRAINT custom_foods_carbs_check CHECK (carbs BETWEEN 0 AND 1000),
  CONSTRAINT custom_foods_fat_check CHECK (fat BETWEEN 0 AND 500)
);

ALTER TABLE public.custom_foods ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own custom foods" ON public.custom_foods
FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own custom foods" ON public.custom_foods
FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own custom foods" ON public.custom_foods
FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own custom foods" ON public.custom_foods
FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER update_custom_foods_updated_at
BEFORE UPDATE ON public.custom_foods
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_custom_foods_user_name
ON public.custom_foods (user_id, lower(name));

CREATE INDEX IF NOT EXISTS idx_custom_foods_user_barcode
ON public.custom_foods (user_id, barcode)
WHERE barcode IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.recent_foods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  food_name TEXT NOT NULL,
  serving_size TEXT NOT NULL DEFAULT '1 serving',
  calories INT NOT NULL,
  protein NUMERIC(8, 2) NOT NULL,
  carbs NUMERIC(8, 2) NOT NULL,
  fat NUMERIC(8, 2) NOT NULL,
  source TEXT NOT NULL DEFAULT 'meal',
  use_count INT NOT NULL DEFAULT 1,
  last_used_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT recent_foods_name_length_check CHECK (char_length(btrim(food_name)) BETWEEN 1 AND 120),
  CONSTRAINT recent_foods_serving_size_length_check CHECK (char_length(btrim(serving_size)) BETWEEN 1 AND 120),
  CONSTRAINT recent_foods_source_check CHECK (source IN ('meal', 'custom', 'template', 'barcode')),
  CONSTRAINT recent_foods_use_count_check CHECK (use_count >= 1),
  CONSTRAINT recent_foods_calories_check CHECK (calories BETWEEN 0 AND 5000),
  CONSTRAINT recent_foods_protein_check CHECK (protein BETWEEN 0 AND 500),
  CONSTRAINT recent_foods_carbs_check CHECK (carbs BETWEEN 0 AND 1000),
  CONSTRAINT recent_foods_fat_check CHECK (fat BETWEEN 0 AND 500),
  CONSTRAINT recent_foods_user_food_serving_unique UNIQUE (user_id, food_name, serving_size)
);

ALTER TABLE public.recent_foods ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own recent foods" ON public.recent_foods
FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can upsert own recent foods" ON public.recent_foods
FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own recent foods" ON public.recent_foods
FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own recent foods" ON public.recent_foods
FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_recent_foods_user_last_used
ON public.recent_foods (user_id, last_used_at DESC);

CREATE TABLE IF NOT EXISTS public.meal_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  meal_type TEXT,
  is_favorite BOOLEAN NOT NULL DEFAULT FALSE,
  last_used_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT meal_templates_name_length_check CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  CONSTRAINT meal_templates_meal_type_check CHECK (
    meal_type IS NULL OR meal_type IN ('breakfast', 'lunch', 'dinner', 'snack')
  )
);

ALTER TABLE public.meal_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own meal templates" ON public.meal_templates
FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own meal templates" ON public.meal_templates
FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own meal templates" ON public.meal_templates
FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own meal templates" ON public.meal_templates
FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER update_meal_templates_updated_at
BEFORE UPDATE ON public.meal_templates
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_meal_templates_user_recent
ON public.meal_templates (user_id, COALESCE(last_used_at, created_at) DESC);

CREATE TABLE IF NOT EXISTS public.meal_template_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID NOT NULL REFERENCES public.meal_templates(id) ON DELETE CASCADE,
  client_item_index INT NOT NULL,
  food_name TEXT NOT NULL,
  quantity NUMERIC(8, 2) NOT NULL DEFAULT 1,
  serving_size TEXT NOT NULL DEFAULT '1 serving',
  calories INT NOT NULL DEFAULT 0,
  protein NUMERIC(8, 2) NOT NULL DEFAULT 0,
  carbs NUMERIC(8, 2) NOT NULL DEFAULT 0,
  fat NUMERIC(8, 2) NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT meal_template_items_food_name_length_check CHECK (char_length(btrim(food_name)) BETWEEN 1 AND 120),
  CONSTRAINT meal_template_items_serving_size_length_check CHECK (char_length(btrim(serving_size)) BETWEEN 1 AND 120),
  CONSTRAINT meal_template_items_unique_index UNIQUE (template_id, client_item_index),
  CONSTRAINT meal_template_items_quantity_check CHECK (quantity BETWEEN 0 AND 100),
  CONSTRAINT meal_template_items_calories_check CHECK (calories BETWEEN 0 AND 5000),
  CONSTRAINT meal_template_items_protein_check CHECK (protein BETWEEN 0 AND 500),
  CONSTRAINT meal_template_items_carbs_check CHECK (carbs BETWEEN 0 AND 1000),
  CONSTRAINT meal_template_items_fat_check CHECK (fat BETWEEN 0 AND 500)
);

ALTER TABLE public.meal_template_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own meal template items" ON public.meal_template_items
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.meal_templates
    WHERE meal_templates.id = meal_template_items.template_id
      AND meal_templates.user_id = auth.uid()
  )
);

CREATE POLICY "Users can insert own meal template items" ON public.meal_template_items
FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.meal_templates
    WHERE meal_templates.id = meal_template_items.template_id
      AND meal_templates.user_id = auth.uid()
  )
);

CREATE POLICY "Users can update own meal template items" ON public.meal_template_items
FOR UPDATE USING (
  EXISTS (
    SELECT 1 FROM public.meal_templates
    WHERE meal_templates.id = meal_template_items.template_id
      AND meal_templates.user_id = auth.uid()
  )
);

CREATE POLICY "Users can delete own meal template items" ON public.meal_template_items
FOR DELETE USING (
  EXISTS (
    SELECT 1 FROM public.meal_templates
    WHERE meal_templates.id = meal_template_items.template_id
      AND meal_templates.user_id = auth.uid()
  )
);

CREATE TABLE IF NOT EXISTS public.reminder_preferences (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  timezone_name TEXT NOT NULL DEFAULT 'UTC',
  quiet_hours_start TIME NOT NULL DEFAULT '22:00',
  quiet_hours_end TIME NOT NULL DEFAULT '06:00',
  breakfast_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  lunch_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  dinner_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  snack_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT reminder_preferences_timezone_length_check CHECK (char_length(timezone_name) BETWEEN 3 AND 80)
);

ALTER TABLE public.reminder_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own reminder preferences" ON public.reminder_preferences
FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can upsert own reminder preferences" ON public.reminder_preferences
FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own reminder preferences" ON public.reminder_preferences
FOR UPDATE USING (auth.uid() = user_id);

CREATE TRIGGER update_reminder_preferences_updated_at
BEFORE UPDATE ON public.reminder_preferences
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.profile_audit_logs (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  changed_by UUID,
  action TEXT NOT NULL,
  changes JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT profile_audit_logs_action_check CHECK (action IN ('insert', 'update'))
);

ALTER TABLE public.profile_audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile audit logs" ON public.profile_audit_logs
FOR SELECT USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.capture_profile_audit_log()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_changes JSONB;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_changes := to_jsonb(NEW);

    INSERT INTO public.profile_audit_logs (user_id, changed_by, action, changes)
    VALUES (NEW.user_id, auth.uid(), 'insert', v_changes);

    RETURN NEW;
  END IF;

  v_changes := jsonb_build_object(
    'before', to_jsonb(OLD),
    'after', to_jsonb(NEW)
  );

  INSERT INTO public.profile_audit_logs (user_id, changed_by, action, changes)
  VALUES (NEW.user_id, auth.uid(), 'update', v_changes);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_capture_profile_audit_log ON public.profiles;
CREATE TRIGGER trg_capture_profile_audit_log
AFTER INSERT OR UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.capture_profile_audit_log();

CREATE OR REPLACE FUNCTION public.get_goal_adjustment(p_goal TEXT, p_target_pace TEXT)
RETURNS INT
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF p_goal = 'lose' THEN
    IF p_target_pace = 'slow' THEN RETURN -250; END IF;
    IF p_target_pace = 'aggressive' THEN RETURN -750; END IF;
    RETURN -500;
  END IF;

  IF p_goal = 'gain' THEN
    IF p_target_pace = 'slow' THEN RETURN 150; END IF;
    IF p_target_pace = 'aggressive' THEN RETURN 450; END IF;
    RETURN 300;
  END IF;

  RETURN 0;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_expected_weekly_weight_change(p_goal TEXT, p_target_pace TEXT)
RETURNS NUMERIC
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF p_goal = 'lose' THEN
    IF p_target_pace = 'slow' THEN RETURN -0.25; END IF;
    IF p_target_pace = 'aggressive' THEN RETURN -0.75; END IF;
    RETURN -0.50;
  END IF;

  IF p_goal = 'gain' THEN
    IF p_target_pace = 'slow' THEN RETURN 0.20; END IF;
    IF p_target_pace = 'aggressive' THEN RETURN 0.50; END IF;
    RETURN 0.35;
  END IF;

  RETURN 0;
END;
$$;

CREATE OR REPLACE FUNCTION public.calculate_calorie_target(
  p_age INT,
  p_weight_kg NUMERIC,
  p_height_cm NUMERIC,
  p_gender TEXT,
  p_activity_level TEXT,
  p_goal TEXT,
  p_target_pace TEXT DEFAULT 'medium'
)
RETURNS TABLE (
  daily_calories INT,
  protein_grams INT,
  carbs_grams INT,
  fat_grams INT,
  expected_weekly_change_kg NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_gender_constant INT;
  v_activity_multiplier NUMERIC;
  v_goal_adjustment INT;
  v_bmr NUMERIC;
  v_tdee NUMERIC;
  v_goal TEXT;
  v_target_pace TEXT;
BEGIN
  IF p_age IS NULL OR p_age < 13 OR p_age > 120 THEN
    RAISE EXCEPTION 'Age must be between 13 and 120';
  END IF;

  IF p_weight_kg IS NULL OR p_weight_kg < 25 OR p_weight_kg > 400 THEN
    RAISE EXCEPTION 'Weight must be between 25kg and 400kg';
  END IF;

  IF p_height_cm IS NULL OR p_height_cm < 90 OR p_height_cm > 250 THEN
    RAISE EXCEPTION 'Height must be between 90cm and 250cm';
  END IF;

  IF p_gender NOT IN ('male', 'female', 'non_binary') THEN
    RAISE EXCEPTION 'Gender must be one of male, female, non_binary';
  END IF;

  IF p_activity_level NOT IN ('sedentary', 'light', 'moderate', 'active', 'very_active') THEN
    RAISE EXCEPTION 'Invalid activity level';
  END IF;

  v_goal := COALESCE(p_goal, 'maintain');
  IF v_goal NOT IN ('lose', 'maintain', 'gain') THEN
    RAISE EXCEPTION 'Invalid goal';
  END IF;

  v_target_pace := COALESCE(p_target_pace, 'medium');
  IF v_target_pace NOT IN ('slow', 'medium', 'aggressive') THEN
    RAISE EXCEPTION 'Invalid target pace';
  END IF;

  v_gender_constant := CASE
    WHEN p_gender = 'male' THEN 5
    WHEN p_gender = 'female' THEN -161
    ELSE -78
  END;

  v_activity_multiplier := CASE p_activity_level
    WHEN 'sedentary' THEN 1.2
    WHEN 'light' THEN 1.375
    WHEN 'moderate' THEN 1.55
    WHEN 'active' THEN 1.725
    WHEN 'very_active' THEN 1.9
  END;

  v_goal_adjustment := public.get_goal_adjustment(v_goal, v_target_pace);

  v_bmr := (10 * p_weight_kg) + (6.25 * p_height_cm) - (5 * p_age) + v_gender_constant;
  v_tdee := v_bmr * v_activity_multiplier;

  daily_calories := LEAST(GREATEST(ROUND(v_tdee + v_goal_adjustment), 1200), 4500);

  protein_grams := CASE v_goal
    WHEN 'lose' THEN GREATEST(ROUND(p_weight_kg * 2.0), 80)
    WHEN 'gain' THEN GREATEST(ROUND(p_weight_kg * 1.8), 80)
    ELSE GREATEST(ROUND(p_weight_kg * 1.6), 80)
  END;

  fat_grams := CASE v_goal
    WHEN 'lose' THEN GREATEST(ROUND(p_weight_kg * 0.8), 40)
    WHEN 'gain' THEN GREATEST(ROUND(p_weight_kg * 1.0), 40)
    ELSE GREATEST(ROUND(p_weight_kg * 0.9), 40)
  END;

  carbs_grams := GREATEST(
    ROUND((daily_calories - (protein_grams * 4) - (fat_grams * 9)) / 4.0),
    80
  );

  expected_weekly_change_kg := public.get_expected_weekly_weight_change(v_goal, v_target_pace);

  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.recompute_profile_calorie_target(p_user_id UUID DEFAULT auth.uid())
RETURNS TABLE (
  daily_calories INT,
  protein_grams INT,
  carbs_grams INT,
  fat_grams INT,
  expected_weekly_change_kg NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_profile public.profiles%ROWTYPE;
  v_previous_target INT;
BEGIN
  v_user_id := COALESCE(p_user_id, auth.uid());

  IF v_user_id IS NULL OR v_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT *
  INTO v_profile
  FROM public.profiles
  WHERE user_id = v_user_id;

  IF v_profile.user_id IS NULL THEN
    RAISE EXCEPTION 'Profile not found';
  END IF;

  IF v_profile.age IS NULL OR v_profile.weight_kg IS NULL OR v_profile.height_cm IS NULL
    OR v_profile.gender IS NULL OR v_profile.activity_level IS NULL OR v_profile.goal IS NULL THEN
    RAISE EXCEPTION 'Profile is incomplete';
  END IF;

  v_previous_target := COALESCE(v_profile.daily_calorie_goal, 2000);

  SELECT t.daily_calories, t.protein_grams, t.carbs_grams, t.fat_grams, t.expected_weekly_change_kg
  INTO daily_calories, protein_grams, carbs_grams, fat_grams, expected_weekly_change_kg
  FROM public.calculate_calorie_target(
    v_profile.age,
    v_profile.weight_kg,
    v_profile.height_cm,
    v_profile.gender,
    v_profile.activity_level,
    v_profile.goal,
    v_profile.target_pace
  ) AS t;

  UPDATE public.profiles
  SET
    daily_calorie_goal = daily_calories,
    baseline_calorie_goal = COALESCE(baseline_calorie_goal, daily_calories),
    last_target_recalculated_on = CURRENT_DATE
  WHERE user_id = v_user_id;

  INSERT INTO public.calorie_target_adjustments (
    user_id,
    effective_date,
    previous_target,
    new_target,
    adjustment,
    reason,
    details
  )
  VALUES (
    v_user_id,
    CURRENT_DATE,
    v_previous_target,
    daily_calories,
    daily_calories - v_previous_target,
    'profile_recompute',
    jsonb_build_object('source', 'rpc', 'target_pace', v_profile.target_pace)
  );

  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.recalculate_adaptive_calorie_target(
  p_user_id UUID DEFAULT auth.uid(),
  p_effective_date DATE DEFAULT CURRENT_DATE
)
RETURNS TABLE (
  previous_target INT,
  new_target INT,
  weekly_weight_change NUMERIC,
  expected_weekly_change NUMERIC,
  adjustment INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_profile public.profiles%ROWTYPE;
  v_recent_avg NUMERIC;
  v_previous_avg NUMERIC;
  v_delta NUMERIC;
  v_expected NUMERIC;
  v_current_target INT;
  v_candidate_target INT;
  v_baseline INT;
  v_min_guardrail INT;
  v_max_guardrail INT;
  v_adjustment INT := 0;
BEGIN
  v_user_id := COALESCE(p_user_id, auth.uid());

  IF v_user_id IS NULL OR v_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT *
  INTO v_profile
  FROM public.profiles
  WHERE user_id = v_user_id;

  IF v_profile.user_id IS NULL THEN
    RAISE EXCEPTION 'Profile not found';
  END IF;

  v_current_target := COALESCE(v_profile.daily_calorie_goal, 2000);
  v_baseline := COALESCE(v_profile.baseline_calorie_goal, v_current_target);

  previous_target := v_current_target;
  new_target := v_current_target;

  IF NOT COALESCE(v_profile.adaptive_calorie_target_enabled, TRUE) THEN
    weekly_weight_change := 0;
    expected_weekly_change := public.get_expected_weekly_weight_change(COALESCE(v_profile.goal, 'maintain'), COALESCE(v_profile.target_pace, 'medium'));
    adjustment := 0;
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT AVG(weight_kg)::NUMERIC
  INTO v_recent_avg
  FROM public.weight_checkins
  WHERE user_id = v_user_id
    AND date BETWEEN (p_effective_date - 6) AND p_effective_date;

  SELECT AVG(weight_kg)::NUMERIC
  INTO v_previous_avg
  FROM public.weight_checkins
  WHERE user_id = v_user_id
    AND date BETWEEN (p_effective_date - 13) AND (p_effective_date - 7);

  IF v_recent_avg IS NULL OR v_previous_avg IS NULL THEN
    UPDATE public.profiles
    SET last_target_recalculated_on = p_effective_date
    WHERE user_id = v_user_id;

    weekly_weight_change := 0;
    expected_weekly_change := public.get_expected_weekly_weight_change(COALESCE(v_profile.goal, 'maintain'), COALESCE(v_profile.target_pace, 'medium'));
    adjustment := 0;
    RETURN NEXT;
    RETURN;
  END IF;

  v_delta := ROUND(v_recent_avg - v_previous_avg, 2);
  v_expected := public.get_expected_weekly_weight_change(COALESCE(v_profile.goal, 'maintain'), COALESCE(v_profile.target_pace, 'medium'));

  IF COALESCE(v_profile.goal, 'maintain') = 'lose' THEN
    IF v_delta > (v_expected + 0.15) THEN
      v_adjustment := -100;
    ELSIF v_delta < (v_expected - 0.15) THEN
      v_adjustment := 100;
    END IF;
  ELSIF COALESCE(v_profile.goal, 'maintain') = 'gain' THEN
    IF v_delta < (v_expected - 0.15) THEN
      v_adjustment := 100;
    ELSIF v_delta > (v_expected + 0.15) THEN
      v_adjustment := -100;
    END IF;
  ELSE
    IF v_delta > 0.20 THEN
      v_adjustment := -100;
    ELSIF v_delta < -0.20 THEN
      v_adjustment := 100;
    END IF;
  END IF;

  v_min_guardrail := GREATEST(1200, v_baseline - 300);
  v_max_guardrail := LEAST(4500, v_baseline + 300);
  v_candidate_target := LEAST(GREATEST(v_current_target + v_adjustment, v_min_guardrail), v_max_guardrail);

  UPDATE public.profiles
  SET
    daily_calorie_goal = v_candidate_target,
    last_target_recalculated_on = p_effective_date
  WHERE user_id = v_user_id;

  IF v_candidate_target <> v_current_target THEN
    INSERT INTO public.calorie_target_adjustments (
      user_id,
      effective_date,
      previous_target,
      new_target,
      adjustment,
      reason,
      details
    )
    VALUES (
      v_user_id,
      p_effective_date,
      v_current_target,
      v_candidate_target,
      v_candidate_target - v_current_target,
      'adaptive_weekly',
      jsonb_build_object(
        'weekly_weight_change', v_delta,
        'expected_weekly_change', v_expected,
        'baseline', v_baseline,
        'guardrails', jsonb_build_object('min', v_min_guardrail, 'max', v_max_guardrail)
      )
    );
  END IF;

  previous_target := v_current_target;
  new_target := v_candidate_target;
  weekly_weight_change := v_delta;
  expected_weekly_change := v_expected;
  adjustment := v_candidate_target - v_current_target;

  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.calculate_calorie_target(INT, NUMERIC, NUMERIC, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.recompute_profile_calorie_target(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.recalculate_adaptive_calorie_target(UUID, DATE) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.calculate_calorie_target(INT, NUMERIC, NUMERIC, TEXT, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_profile_calorie_target(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.recalculate_adaptive_calorie_target(UUID, DATE) TO authenticated;
