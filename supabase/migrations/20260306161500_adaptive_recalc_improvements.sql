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
  v_delta NUMERIC := 0;
  v_expected NUMERIC;
  v_current_target INT;
  v_candidate_target INT;
  v_baseline INT;
  v_min_guardrail INT;
  v_max_guardrail INT;
  v_adjustment INT := 0;
  v_recent_count INT := 0;
  v_previous_count INT := 0;
  v_available_count INT := 0;
  v_span_days INT := 0;
  v_latest_avg NUMERIC;
  v_oldest_avg NUMERIC;
  v_has_sufficient_data BOOLEAN := FALSE;
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

  SELECT AVG(weight_kg)::NUMERIC, COUNT(*)
  INTO v_recent_avg, v_recent_count
  FROM public.weight_checkins
  WHERE user_id = v_user_id
    AND date BETWEEN (p_effective_date - 6) AND p_effective_date;

  SELECT AVG(weight_kg)::NUMERIC, COUNT(*)
  INTO v_previous_avg, v_previous_count
  FROM public.weight_checkins
  WHERE user_id = v_user_id
    AND date BETWEEN (p_effective_date - 13) AND (p_effective_date - 7);

  IF v_recent_count >= 3 AND v_previous_count >= 3 AND v_recent_avg IS NOT NULL AND v_previous_avg IS NOT NULL THEN
    v_delta := ROUND(v_recent_avg - v_previous_avg, 2);
    v_has_sufficient_data := TRUE;
  ELSE
    SELECT COUNT(*), COALESCE(MAX(date) - MIN(date), 0)
    INTO v_available_count, v_span_days
    FROM public.weight_checkins
    WHERE user_id = v_user_id
      AND date BETWEEN (p_effective_date - 20) AND p_effective_date;

    IF v_available_count >= 4 AND v_span_days >= 7 THEN
      SELECT AVG(weight_kg)::NUMERIC
      INTO v_latest_avg
      FROM (
        SELECT weight_kg
        FROM public.weight_checkins
        WHERE user_id = v_user_id
          AND date <= p_effective_date
        ORDER BY date DESC
        LIMIT 3
      ) latest;

      SELECT AVG(weight_kg)::NUMERIC
      INTO v_oldest_avg
      FROM (
        SELECT weight_kg
        FROM public.weight_checkins
        WHERE user_id = v_user_id
          AND date BETWEEN (p_effective_date - 20) AND p_effective_date
        ORDER BY date ASC
        LIMIT 3
      ) oldest;

      IF v_latest_avg IS NOT NULL AND v_oldest_avg IS NOT NULL THEN
        v_delta := ROUND((v_latest_avg - v_oldest_avg) * (7.0 / GREATEST(v_span_days, 1)), 2);
        v_has_sufficient_data := TRUE;
      END IF;
    END IF;
  END IF;

  v_expected := public.get_expected_weekly_weight_change(COALESCE(v_profile.goal, 'maintain'), COALESCE(v_profile.target_pace, 'medium'));

  IF NOT v_has_sufficient_data THEN
    weekly_weight_change := 0;
    expected_weekly_change := v_expected;
    adjustment := 0;
    RETURN NEXT;
    RETURN;
  END IF;

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
        'guardrails', jsonb_build_object('min', v_min_guardrail, 'max', v_max_guardrail),
        'method', CASE WHEN v_recent_count >= 3 AND v_previous_count >= 3 THEN 'two_window_avg' ELSE 'fallback_slope' END
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
