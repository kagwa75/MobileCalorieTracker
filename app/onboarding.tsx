import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import { Redirect, router } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import {
  activityLevelValues,
  calculateDailyCalorieTarget,
  calculateDailyMacroTargets,
  dietaryPreferenceValues,
  type DietaryPreference,
  type ActivityLevel,
  type Gender,
  goalValues,
  type Goal,
  genderValues,
  targetPaceValues,
  type TargetPace
} from "@/lib/calorieTarget";
import { useAuth } from "@/providers/AuthProvider";
import { isOnboardingComplete, useCalorieTargetRpc, useProfile, useUpdateProfile } from "@/hooks/useProfile";
import { useUpsertWeightCheckin } from "@/hooks/useWeights";
import { captureClientError } from "@/lib/monitoring";
import { formatDateKey } from "@/lib/date";
import { validateOnboardingInput } from "@/lib/flowValidation";
import { colors, radius } from "@/theme/tokens";

// ─── Constants ────────────────────────────────────────────────────────────────

const TOTAL_STEPS = 3;

const genderOptions: Array<{ value: Gender; label: string; icon: keyof typeof MaterialCommunityIcons.glyphMap }> = [
  { value: "male", label: "Male", icon: "gender-male" },
  { value: "female", label: "Female", icon: "gender-female" },
  { value: "non_binary", label: "Non-binary", icon: "gender-transgender" }
];

const activityOptions: Array<{
  value: ActivityLevel;
  label: string;
  subtitle: string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
}> = [
  { value: "sedentary", label: "Sedentary", subtitle: "Desk job, little exercise", icon: "laptop" },
  { value: "light", label: "Light", subtitle: "1–3 days/week", icon: "walk" },
  { value: "moderate", label: "Moderate", subtitle: "3–5 days/week", icon: "run" },
  { value: "active", label: "Active", subtitle: "Hard training most days", icon: "bike" },
  { value: "very_active", label: "Very active", subtitle: "Athlete-level", icon: "weight-lifter" }
];

const goalOptions: Array<{
  value: Goal;
  label: string;
  subtitle: string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  color: string;
  bg: string;
}> = [
  { value: "lose", label: "Lose weight", subtitle: "Calorie deficit", icon: "trending-down", color: "#f43f5e", bg: "#fff1f2" },
  { value: "maintain", label: "Maintain", subtitle: "Stay balanced", icon: "scale-balance", color: "#6366f1", bg: "#eef2ff" },
  { value: "gain", label: "Gain weight", subtitle: "Lean surplus", icon: "trending-up", color: "#10b981", bg: "#ecfdf5" }
];

const paceOptions: Array<{ value: TargetPace; label: string; kgPerWeek: string; description: string }> = [
  { value: "slow", label: "Slow", kgPerWeek: "±0.25 kg/wk", description: "Gentle, sustainable" },
  { value: "medium", label: "Medium", kgPerWeek: "±0.5 kg/wk", description: "Balanced pace" },
  { value: "aggressive", label: "Fast", kgPerWeek: "±0.75 kg/wk", description: "Faster results" }
];

const dietOptions: Array<{
  value: DietaryPreference;
  label: string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  color: string;
}> = [
  { value: "balanced", label: "Balanced", icon: "food-apple-outline", color: "#f59e0b" },
  { value: "high_protein", label: "High protein", icon: "arm-flex-outline", color: "#3b82f6" },
  { value: "low_carb", label: "Low carb", icon: "bread-slice-outline", color: "#8b5cf6" },
  { value: "vegetarian", label: "Vegetarian", icon: "sprout-outline", color: "#10b981" },
  { value: "vegan", label: "Vegan", icon: "leaf", color: "#059669" }
];

const MIN_AGE = 13, MAX_AGE = 120;
const MIN_WEIGHT = 25, MAX_WEIGHT = 400;
const MIN_HEIGHT = 90, MAX_HEIGHT = 250;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseBoundedNumber(value: string, min: number, max: number) {
  const parsed = Number.parseFloat(value.replace(",", "."));
  if (!Number.isFinite(parsed)) return null;
  if (parsed < min || parsed > max) return null;
  return parsed;
}

function parseBoundedInteger(value: string, min: number, max: number) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return null;
  if (parsed < min || parsed > max) return null;
  return parsed;
}

function getSuggestedTargetWeight(currentWeight: number, goal: Goal, targetPace: TargetPace) {
  if (goal === "maintain") return currentWeight;
  const delta = goal === "lose"
    ? targetPace === "slow" ? -3 : targetPace === "aggressive" ? -9 : -6
    : targetPace === "slow" ? 2 : targetPace === "aggressive" ? 6 : 4;
  return Math.max(25, Number((currentWeight + delta).toFixed(1)));
}

function clamp(val: number, min: number, max: number) {
  return Math.min(Math.max(val, min), max);
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StepHeader({
  step,
  title,
  subtitle
}: {
  step: number;
  title: string;
  subtitle: string;
}) {
  return (
    <View style={sh.wrap}>
      <Text style={sh.step}>Step {step} of {TOTAL_STEPS}</Text>
      <Text style={sh.title}>{title}</Text>
      <Text style={sh.subtitle}>{subtitle}</Text>
    </View>
  );
}

const sh = StyleSheet.create({
  wrap: { marginBottom: 20 },
  step: { fontSize: 12, fontWeight: "700", color: colors.primary, letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 6 },
  title: { fontSize: 26, fontWeight: "900", color: "#0f172a", lineHeight: 30, marginBottom: 6 },
  subtitle: { fontSize: 14, color: "#64748b", lineHeight: 20 }
});

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <Text style={styles.fieldLabel}>{children}</Text>;
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <View style={styles.errorRow}>
      <MaterialCommunityIcons name="alert-circle-outline" size={12} color="#be123c" />
      <Text style={styles.errorText}>{message}</Text>
    </View>
  );
}

function UnitInput({
  value,
  onChange,
  placeholder,
  unit,
  keyboardType = "decimal-pad",
  error,
  onStepUp,
  onStepDown,
  stepAmount = 1
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  unit: string;
  keyboardType?: "numeric" | "decimal-pad";
  error?: string;
  onStepUp: () => void;
  onStepDown: () => void;
  stepAmount?: number;
}) {
  return (
    <View>
      <View style={[styles.unitInputWrap, error ? styles.unitInputError : null]}>
        <TextInput
          value={value}
          onChangeText={onChange}
          keyboardType={keyboardType}
          placeholder={placeholder}
          placeholderTextColor="#94a3b8"
          style={styles.unitInputText}
        />
        <Text style={styles.unitLabel}>{unit}</Text>
        <View style={styles.stepperCol}>
          <Pressable onPress={onStepUp} style={styles.stepBtn} hitSlop={8}>
            <MaterialCommunityIcons name="chevron-up" size={14} color="#64748b" />
          </Pressable>
          <Pressable onPress={onStepDown} style={[styles.stepBtn, { borderTopWidth: 1, borderTopColor: "#e2e8f0" }]} hitSlop={8}>
            <MaterialCommunityIcons name="chevron-down" size={14} color="#64748b" />
          </Pressable>
        </View>
      </View>
      <FieldError message={error} />
    </View>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function OnboardingScreen() {
  const { user } = useAuth();
  const { data: profile, isLoading: profileLoading } = useProfile();
  const updateProfile = useUpdateProfile();
  const calorieTargetRpc = useCalorieTargetRpc();
  const upsertWeight = useUpsertWeightCheckin();

  // Step state
  const [step, setStep] = useState(1);
  const slideAnim = useRef(new Animated.Value(0)).current;
  const fadeAnim = useRef(new Animated.Value(1)).current;

  // Form state
  const [hydrated, setHydrated] = useState(false);
  const [age, setAge] = useState("");
  const [weightKg, setWeightKg] = useState("");
  const [heightCm, setHeightCm] = useState("");
  const [gender, setGender] = useState<Gender>("female");
  const [activityLevel, setActivityLevel] = useState<ActivityLevel>("moderate");
  const [goal, setGoal] = useState<Goal>("maintain");
  const [targetPace, setTargetPace] = useState<TargetPace>("medium");
  const [dietaryPreference, setDietaryPreference] = useState<DietaryPreference>("balanced");

  // Validation errors
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (hydrated || !profile) return;
    if (profile.age) setAge(String(profile.age));
    if (profile.weight_kg) setWeightKg(String(profile.weight_kg));
    if (profile.height_cm) setHeightCm(String(profile.height_cm));
    if (profile.gender && genderValues.includes(profile.gender)) setGender(profile.gender);
    if (profile.activity_level && activityLevelValues.includes(profile.activity_level)) setActivityLevel(profile.activity_level);
    if (profile.goal && goalValues.includes(profile.goal)) setGoal(profile.goal);
    if (profile.target_pace && targetPaceValues.includes(profile.target_pace)) setTargetPace(profile.target_pace);
    if (profile.dietary_preference && dietaryPreferenceValues.includes(profile.dietary_preference)) setDietaryPreference(profile.dietary_preference);
    setHydrated(true);
  }, [hydrated, profile]);

  // Parsed values
  const parsedAge = parseBoundedInteger(age, MIN_AGE, MAX_AGE);
  const parsedWeight = parseBoundedNumber(weightKg, MIN_WEIGHT, MAX_WEIGHT);
  const parsedHeight = parseBoundedNumber(heightCm, MIN_HEIGHT, MAX_HEIGHT);

  // Live calorie preview
  const projectedCalories = useMemo(() => {
    if (!parsedAge || !parsedWeight || !parsedHeight) return null;
    return calculateDailyCalorieTarget({
      age: parsedAge, weightKg: parsedWeight, heightCm: parsedHeight,
      gender, activityLevel, goal, targetPace
    });
  }, [parsedAge, parsedWeight, parsedHeight, gender, activityLevel, goal, targetPace]);

  const projectedMacros = useMemo(() => {
    if (!projectedCalories || !parsedWeight) return null;
    return calculateDailyMacroTargets({
      dailyCalories: projectedCalories, goal, weightKg: parsedWeight, dietaryPreference
    });
  }, [projectedCalories, parsedWeight, goal, dietaryPreference]);

  // Calorie range estimate (when not all fields filled)
  const calorieRangeHint = useMemo(() => {
    if (projectedCalories) return null;
    if (!parsedWeight || !parsedHeight) return "~1,500–2,500 kcal";
    if (!parsedAge) return "~1,600–2,400 kcal";
    return null;
  }, [projectedCalories, parsedAge, parsedWeight, parsedHeight]);

  // Animated transition between steps
  const animateStep = (direction: 1 | -1, newStep: number) => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 0, duration: 120, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: direction * -30, duration: 120, useNativeDriver: true })
    ]).start(() => {
      setStep(newStep);
      slideAnim.setValue(direction * 30);
      Animated.parallel([
        Animated.timing(fadeAnim, { toValue: 1, duration: 180, useNativeDriver: true }),
        Animated.timing(slideAnim, { toValue: 0, duration: 180, useNativeDriver: true })
      ]).start();
    });
  };

  // Step 1 validation
  const validateStep1 = (): boolean => {
    const newErrors: Record<string, string> = {};
    if (!age.trim()) newErrors.age = "Required";
    else if (!parsedAge) newErrors.age = `Must be ${MIN_AGE}–${MAX_AGE}`;
    if (!weightKg.trim()) newErrors.weight = "Required";
    else if (!parsedWeight) newErrors.weight = `Must be ${MIN_WEIGHT}–${MAX_WEIGHT} kg`;
    if (!heightCm.trim()) newErrors.height = "Required";
    else if (!parsedHeight) newErrors.height = `Must be ${MIN_HEIGHT}–${MAX_HEIGHT} cm`;
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const goNext = () => {
    if (step === 1 && !validateStep1()) return;
    if (step < TOTAL_STEPS) animateStep(1, step + 1);
  };

  const goBack = () => {
    if (step > 1) animateStep(-1, step - 1);
  };

  // Stepper helpers
  const stepAge = (dir: 1 | -1) => {
    const current = parsedAge ?? 25;
    setAge(String(clamp(current + dir, MIN_AGE, MAX_AGE)));
  };
  const stepWeight = (dir: 1 | -1) => {
    const current = parsedWeight ?? 70;
    setWeightKg(String(clamp(Number((current + dir * 0.5).toFixed(1)), MIN_WEIGHT, MAX_WEIGHT)));
  };
  const stepHeight = (dir: 1 | -1) => {
    const current = parsedHeight ?? 170;
    setHeightCm(String(clamp(Number((current + dir).toFixed(1)), MIN_HEIGHT, MAX_HEIGHT)));
  };

  const onFinish = async () => {
    const validationError = validateOnboardingInput({
      age: parsedAge, weightKg: parsedWeight, heightCm: parsedHeight,
      gender, activityLevel, goal, targetPace
    });
    if (validationError) { Alert.alert("Invalid input", validationError); return; }
    if (!parsedAge || !parsedWeight || !parsedHeight) return;

    try {
      const rpcTarget = await calorieTargetRpc.mutateAsync({
        age: parsedAge, weightKg: parsedWeight, heightCm: parsedHeight,
        gender, activityLevel, goal, targetPace
      });
      await updateProfile.mutateAsync({
        age: parsedAge,
        weight_kg: Number(parsedWeight.toFixed(1)),
        height_cm: Number(parsedHeight.toFixed(1)),
        gender, activity_level: activityLevel, goal, target_pace: targetPace,
        dietary_preference: dietaryPreference,
        timezone_name: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        daily_calorie_goal: rpcTarget.daily_calories,
        baseline_calorie_goal: rpcTarget.daily_calories,
        target_weight_kg: getSuggestedTargetWeight(parsedWeight, goal, targetPace),
        last_target_recalculated_on: formatDateKey(new Date()),
        onboarding_completed_at: new Date().toISOString()
      });
      await upsertWeight.mutateAsync({ date: formatDateKey(new Date()), weightKg: parsedWeight });
      router.replace("/(tabs)/dashboard");
    } catch (error) {
      void captureClientError(error, { screen: "onboarding", action: "save-profile" });
      Alert.alert("Could not save profile", error instanceof Error ? error.message : "Please try again.");
    }
  };

  if (!user) return <Redirect href="/(auth)/sign-in" />;
  if (profileLoading) {
    return (
      <View style={styles.loadingWrap}>
        <ActivityIndicator color={colors.primary} size="large" />
        <Text style={styles.loadingText}>Getting things ready…</Text>
      </View>
    );
  }
 // if (isOnboardingComplete(profile)) return <Redirect href="/(tabs)/dashboard" />;

  const isSaving = updateProfile.isPending || calorieTargetRpc.isPending;

  return (
    <View style={styles.root}>
      {/* ── Top bar ── */}
      <View style={styles.topBar}>
        {step > 1 ? (
          <Pressable onPress={goBack} style={styles.backBtn} hitSlop={12}>
            <MaterialCommunityIcons name="arrow-left" size={20} color="#0f172a" />
          </Pressable>
        ) : (
          <View style={styles.backBtnPlaceholder} />
        )}

        {/* Progress bar */}
        <View style={styles.progressWrap}>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${(step / TOTAL_STEPS) * 100}%` }]} />
          </View>
          <Text style={styles.progressLabel}>{step} / {TOTAL_STEPS}</Text>
        </View>

        {/* Time estimate badge */}
        <View style={styles.timeBadge}>
          <MaterialCommunityIcons name="clock-outline" size={11} color={colors.primary} />
          <Text style={styles.timeBadgeText}>2 min</Text>
        </View>
      </View>

      {/* ── Live calorie card (always visible) ── */}
      <View style={styles.calorieCard}>
        <View style={styles.calorieCardLeft}>
          <Text style={styles.calorieCardLabel}>Your daily target</Text>
          <View style={styles.calorieValueRow}>
            <Text style={styles.calorieValue}>
              {projectedCalories ? projectedCalories.toLocaleString() : calorieRangeHint ?? "—"}
            </Text>
            <Text style={styles.calorieUnit}>kcal</Text>
          </View>
          {projectedMacros ? (
            <View style={styles.macroPillRow}>
              <MacroPill label="P" value={`${projectedMacros.proteinGrams}g`} color="#3b82f6" bg="#dbeafe" />
              <MacroPill label="C" value={`${projectedMacros.carbsGrams}g`} color="#10b981" bg="#d1fae5" />
              <MacroPill label="F" value={`${projectedMacros.fatGrams}g`} color="#f59e0b" bg="#fef3c7" />
            </View>
          ) : (
            <Text style={styles.calorieHint}>Fill in your details to see your target</Text>
          )}
        </View>
        <View style={styles.calorieCardIcon}>
          <MaterialCommunityIcons name="target" size={32} color={projectedCalories ? colors.primary : "#cbd5e1"} />
        </View>
      </View>

      {/* ── Step content (animated) ── */}
      <ScrollView
        style={styles.scrollArea}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <Animated.View style={{ opacity: fadeAnim, transform: [{ translateX: slideAnim }] }}>

          {/* ───────────────── STEP 1 : Body metrics ───────────────── */}
          {step === 1 && (
            <View>
              <StepHeader
                step={1}
                title="Your body metrics"
                subtitle="We use these to calculate your personalised calorie target."
              />

              {/* Gender */}
              <FieldLabel>Biological sex</FieldLabel>
              <View style={styles.genderRow}>
                {genderOptions.map((opt) => {
                  const isActive = gender === opt.value;
                  return (
                    <Pressable
                      key={opt.value}
                      onPress={() => setGender(opt.value)}
                      style={[styles.genderCard, isActive && styles.genderCardActive]}
                    >
                      <MaterialCommunityIcons
                        name={opt.icon}
                        size={22}
                        color={isActive ? colors.primary : "#94a3b8"}
                      />
                      <Text style={[styles.genderLabel, isActive && styles.genderLabelActive]}>
                        {opt.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              {/* Age */}
              <View style={styles.metricsGrid}>
                <View style={styles.metricField}>
                  <FieldLabel>Age</FieldLabel>
                  <UnitInput
                    value={age}
                    onChange={(v) => { setAge(v); setErrors((e) => ({ ...e, age: "" })); }}
                    placeholder="25"
                    unit="yrs"
                    keyboardType="numeric"
                    error={errors.age}
                    onStepUp={() => stepAge(1)}
                    onStepDown={() => stepAge(-1)}
                  />
                </View>

                <View style={styles.metricField}>
                  <FieldLabel>Height</FieldLabel>
                  <UnitInput
                    value={heightCm}
                    onChange={(v) => { setHeightCm(v); setErrors((e) => ({ ...e, height: "" })); }}
                    placeholder="175"
                    unit="cm"
                    error={errors.height}
                    onStepUp={() => stepHeight(1)}
                    onStepDown={() => stepHeight(-1)}
                  />
                </View>
              </View>

              <FieldLabel>Current weight</FieldLabel>
              <UnitInput
                value={weightKg}
                onChange={(v) => { setWeightKg(v); setErrors((e) => ({ ...e, weight: "" })); }}
                placeholder="72.5"
                unit="kg"
                error={errors.weight}
                onStepUp={() => stepWeight(1)}
                onStepDown={() => stepWeight(-1)}
                stepAmount={0.5}
              />
            </View>
          )}

          {/* ───────────────── STEP 2 : Lifestyle & goals ───────────────── */}
          {step === 2 && (
            <View>
              <StepHeader
                step={2}
                title="Lifestyle & goals"
                subtitle="Tell us how active you are and what you want to achieve."
              />

              {/* Activity level */}
              <FieldLabel>Activity level</FieldLabel>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.activityScroll}>
                {activityOptions.map((opt) => {
                  const isActive = activityLevel === opt.value;
                  return (
                    <Pressable
                      key={opt.value}
                      onPress={() => setActivityLevel(opt.value)}
                      style={[styles.activityChip, isActive && styles.activityChipActive]}
                    >
                      <MaterialCommunityIcons
                        name={opt.icon}
                        size={20}
                        color={isActive ? "white" : "#64748b"}
                      />
                      <Text style={[styles.activityChipLabel, isActive && styles.activityChipLabelActive]}>
                        {opt.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
              {/* Selected activity subtitle */}
              <View style={styles.activitySubtitleWrap}>
                <MaterialCommunityIcons name="information-outline" size={13} color={colors.primary} />
                <Text style={styles.activitySubtitle}>
                  {activityOptions.find((o) => o.value === activityLevel)?.subtitle}
                </Text>
              </View>

              {/* Goal */}
              <FieldLabel>Primary goal</FieldLabel>
              <View style={styles.goalRow}>
                {goalOptions.map((opt) => {
                  const isActive = goal === opt.value;
                  return (
                    <Pressable
                      key={opt.value}
                      onPress={() => setGoal(opt.value)}
                      style={[
                        styles.goalCard,
                        { backgroundColor: isActive ? opt.color : "#f8fafc", borderColor: isActive ? opt.color : "#e2e8f0" }
                      ]}
                    >
                      <View style={[styles.goalIconWrap, { backgroundColor: isActive ? "rgba(255,255,255,0.25)" : opt.bg }]}>
                        <MaterialCommunityIcons
                          name={opt.icon}
                          size={22}
                          color={isActive ? "white" : opt.color}
                        />
                      </View>
                      <Text style={[styles.goalLabel, isActive && styles.goalLabelActive]}>
                        {opt.label}
                      </Text>
                      <Text style={[styles.goalSub, isActive && styles.goalSubActive]}>
                        {opt.subtitle}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              {/* Target pace */}
              <FieldLabel>Target pace</FieldLabel>
              <View style={styles.paceRow}>
                {paceOptions.map((opt) => {
                  const isActive = targetPace === opt.value;
                  return (
                    <Pressable
                      key={opt.value}
                      onPress={() => setTargetPace(opt.value)}
                      style={[styles.paceCard, isActive && styles.paceCardActive]}
                    >
                      <Text style={[styles.paceLabel, isActive && styles.paceLabelActive]}>{opt.label}</Text>
                      <Text style={[styles.paceKg, isActive && styles.paceKgActive]}>{opt.kgPerWeek}</Text>
                      <Text style={[styles.paceDesc, isActive && styles.paceDescActive]}>{opt.description}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          )}

          {/* ───────────────── STEP 3 : Diet preference ───────────────── */}
          {step === 3 && (
            <View>
              <StepHeader
                step={3}
                title="Dietary preference"
                subtitle="This shapes how your macros are distributed. You can change it anytime."
              />

              <View style={styles.dietGrid}>
                {dietOptions.map((opt) => {
                  const isActive = dietaryPreference === opt.value;
                  return (
                    <Pressable
                      key={opt.value}
                      onPress={() => setDietaryPreference(opt.value)}
                      style={[
                        styles.dietCard,
                        isActive && { borderColor: opt.color, backgroundColor: `${opt.color}12` }
                      ]}
                    >
                      <View style={[styles.dietIconWrap, { backgroundColor: `${opt.color}18` }]}>
                        <MaterialCommunityIcons name={opt.icon} size={24} color={opt.color} />
                      </View>
                      <Text style={[styles.dietLabel, isActive && { color: opt.color }]}>
                        {opt.label}
                      </Text>
                      {isActive && (
                        <View style={[styles.dietCheck, { backgroundColor: opt.color }]}>
                          <MaterialCommunityIcons name="check" size={10} color="white" />
                        </View>
                      )}
                    </Pressable>
                  );
                })}
              </View>

              {/* Summary card */}
              {projectedCalories && projectedMacros && (
                <View style={styles.summaryCard}>
                  <View style={styles.summaryHeader}>
                    <MaterialCommunityIcons name="check-circle" size={18} color="#10b981" />
                    <Text style={styles.summaryTitle}>Your personalised plan is ready</Text>
                  </View>
                  <View style={styles.summaryRow}>
                    <SummaryItem label="Daily calories" value={`${projectedCalories.toLocaleString()} kcal`} />
                    <SummaryItem label="Protein" value={`${projectedMacros.proteinGrams}g`} />
                    <SummaryItem label="Carbs" value={`${projectedMacros.carbsGrams}g`} />
                    <SummaryItem label="Fat" value={`${projectedMacros.fatGrams}g`} />
                  </View>
                  <Text style={styles.summaryGoalLine}>
                    Goal: <Text style={{ fontWeight: "700", color: "#0f172a" }}>
                      {goalOptions.find((g) => g.value === goal)?.label}
                    </Text>
                    {"  ·  "}
                    Pace: <Text style={{ fontWeight: "700", color: "#0f172a" }}>
                      {paceOptions.find((p) => p.value === targetPace)?.kgPerWeek}
                    </Text>
                  </Text>
                </View>
              )}

              {/* Reassurance */}
              <View style={styles.reassuranceRow}>
                <MaterialCommunityIcons name="lock-open-outline" size={14} color="#94a3b8" />
                <Text style={styles.reassuranceText}>
                  You can update any of these in your Profile at any time.
                </Text>
              </View>
            </View>
          )}

        </Animated.View>

        <View style={{ height: 120 }} />
      </ScrollView>

      {/* ── Fixed bottom CTA ── */}
      <View style={styles.ctaWrap}>
        {step < TOTAL_STEPS ? (
          <Pressable onPress={goNext} style={styles.ctaBtn}>
            <Text style={styles.ctaBtnText}>Continue</Text>
            <MaterialCommunityIcons name="arrow-right" size={20} color="white" />
          </Pressable>
        ) : (
          <Pressable
            onPress={() => void onFinish()}
            disabled={isSaving}
            style={[styles.ctaBtn, styles.ctaBtnFinish, isSaving && styles.ctaBtnDisabled]}
          >
            {isSaving ? (
              <ActivityIndicator color="white" />
            ) : (
              <>
                <MaterialCommunityIcons name="check-circle-outline" size={20} color="white" />
                <Text style={styles.ctaBtnText}>Finish setup</Text>
              </>
            )}
          </Pressable>
        )}
        <Text style={styles.ctaSubtext}>
          {step === 1 && "You'll be able to change these later"}
          {step === 2 && "Your calorie target updates in real time above"}
          {step === 3 && "All set — let's start tracking!"}
        </Text>
      </View>
    </View>
  );
}

// ── Small helper components ──────────────────────────────────────────────────

function MacroPill({ label, value, color, bg }: { label: string; value: string; color: string; bg: string }) {
  return (
    <View style={[mpStyles.wrap, { backgroundColor: bg }]}>
      <Text style={[mpStyles.label, { color }]}>{label}</Text>
      <Text style={[mpStyles.value, { color }]}>{value}</Text>
    </View>
  );
}
const mpStyles = StyleSheet.create({
  wrap: { flexDirection: "row", alignItems: "center", gap: 3, borderRadius: 99, paddingHorizontal: 8, paddingVertical: 3 },
  label: { fontSize: 10, fontWeight: "800" },
  value: { fontSize: 11, fontWeight: "700" }
});

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <View style={siStyles.wrap}>
      <Text style={siStyles.value}>{value}</Text>
      <Text style={siStyles.label}>{label}</Text>
    </View>
  );
}
const siStyles = StyleSheet.create({
  wrap: { flex: 1, alignItems: "center" },
  value: { fontSize: 15, fontWeight: "800", color: "#0f172a" },
  label: { fontSize: 10, color: "#64748b", marginTop: 2, fontWeight: "500" }
});

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#ffffff" },
  loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, backgroundColor: "#fff" },
  loadingText: { color: "#94a3b8", fontSize: 14 },

  // Top bar
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 56,
    paddingBottom: 12,
    gap: 12,
    backgroundColor: "#fff"
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: "#f1f5f9",
    alignItems: "center",
    justifyContent: "center"
  },
  backBtnPlaceholder: { width: 36 },
  progressWrap: { flex: 1, gap: 4 },
  progressTrack: {
    height: 6,
    backgroundColor: "#f1f5f9",
    borderRadius: 99,
    overflow: "hidden"
  },
  progressFill: {
    height: "100%",
    backgroundColor: colors.primary,
    borderRadius: 99
  },
  progressLabel: { fontSize: 10, color: "#94a3b8", fontWeight: "700", textAlign: "right" },
  timeBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: `${colors.primary}12`,
    borderRadius: 99,
    paddingHorizontal: 8,
    paddingVertical: 4
  },
  timeBadgeText: { fontSize: 11, fontWeight: "700", color: colors.primary },

  // Live calorie card
  calorieCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginHorizontal: 20,
    marginBottom: 4,
    padding: 16,
    backgroundColor: "#0f172a",
    borderRadius: 18
  },
  calorieCardLeft: { flex: 1 },
  calorieCardLabel: { fontSize: 11, color: "rgba(255,255,255,0.5)", fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 },
  calorieValueRow: { flexDirection: "row", alignItems: "flex-end", gap: 5, marginTop: 2 },
  calorieValue: { fontSize: 36, fontWeight: "900", color: "white", lineHeight: 40 },
  calorieUnit: { fontSize: 13, color: "rgba(255,255,255,0.5)", fontWeight: "600", marginBottom: 6 },
  macroPillRow: { flexDirection: "row", gap: 6, marginTop: 6 },
  calorieHint: { fontSize: 12, color: "rgba(255,255,255,0.35)", marginTop: 6, fontWeight: "500" },
  calorieCardIcon: {
    width: 52,
    height: 52,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.07)",
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 12
  },

  // Scroll area
  scrollArea: { flex: 1 },
  scrollContent: { paddingHorizontal: 20, paddingTop: 24 },

  // Field labels and errors
  fieldLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: "#475569",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 8,
    marginTop: 16
  },
  errorRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 },
  errorText: { fontSize: 11, color: "#be123c", fontWeight: "600" },

  // Unit input
  unitInputWrap: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1.5,
    borderColor: "#e2e8f0",
    borderRadius: 14,
    backgroundColor: "#f8fafc",
    overflow: "hidden"
  },
  unitInputError: { borderColor: "#fca5a5" },
  unitInputText: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 18,
    fontWeight: "700",
    color: "#0f172a"
  },
  unitLabel: {
    fontSize: 13,
    fontWeight: "700",
    color: "#94a3b8",
    paddingHorizontal: 10
  },
  stepperCol: {
    borderLeftWidth: 1,
    borderLeftColor: "#e2e8f0",
    width: 38
  },
  stepBtn: {
    height: 26,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f8fafc"
  },

  // Step 1 – Body
  metricsGrid: { flexDirection: "row", gap: 12 },
  metricField: { flex: 1 },

  // Gender cards
  genderRow: { flexDirection: "row", gap: 10 },
  genderCard: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: "#e2e8f0",
    backgroundColor: "#f8fafc",
    gap: 5
  },
  genderCardActive: {
    borderColor: colors.primary,
    backgroundColor: `${colors.primary}10`
  },
  genderLabel: { fontSize: 12, fontWeight: "700", color: "#64748b" },
  genderLabelActive: { color: colors.primary },

  // Step 2 – Activity
  activityScroll: { marginBottom: 0 },
  activityChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 99,
    backgroundColor: "#f1f5f9",
    marginRight: 8,
    borderWidth: 1.5,
    borderColor: "transparent"
  },
  activityChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary
  },
  activityChipLabel: { fontSize: 13, fontWeight: "700", color: "#475569" },
  activityChipLabelActive: { color: "white" },
  activitySubtitleWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginTop: 8,
    marginBottom: 4,
    backgroundColor: `${colors.primary}0f`,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8
  },
  activitySubtitle: { fontSize: 12, color: colors.primary, fontWeight: "600" },

  // Goal cards
  goalRow: { flexDirection: "row", gap: 10 },
  goalCard: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 16,
    paddingHorizontal: 8,
    borderRadius: 16,
    borderWidth: 2,
    gap: 8
  },
  goalIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center"
  },
  goalLabel: { fontSize: 12, fontWeight: "800", color: "#0f172a", textAlign: "center" },
  goalLabelActive: { color: "white" },
  goalSub: { fontSize: 10, color: "#64748b", textAlign: "center", fontWeight: "500" },
  goalSubActive: { color: "rgba(255,255,255,0.75)" },

  // Pace cards
  paceRow: { flexDirection: "row", gap: 10 },
  paceCard: {
    flex: 1,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: "#e2e8f0",
    backgroundColor: "#f8fafc",
    alignItems: "center",
    gap: 3
  },
  paceCardActive: { borderColor: colors.primary, backgroundColor: `${colors.primary}0f` },
  paceLabel: { fontSize: 13, fontWeight: "800", color: "#0f172a" },
  paceLabelActive: { color: colors.primary },
  paceKg: { fontSize: 12, fontWeight: "700", color: "#64748b" },
  paceKgActive: { color: colors.primary },
  paceDesc: { fontSize: 10, color: "#94a3b8", fontWeight: "500", textAlign: "center" },
  paceDescActive: { color: `${colors.primary}99` },

  // Step 3 – Diet
  dietGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10
  },
  dietCard: {
    width: "47%",
    padding: 14,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: "#e2e8f0",
    backgroundColor: "#f8fafc",
    position: "relative",
    gap: 8
  },
  dietIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center"
  },
  dietLabel: { fontSize: 13, fontWeight: "700", color: "#0f172a" },
  dietCheck: {
    position: "absolute",
    top: 10,
    right: 10,
    width: 18,
    height: 18,
    borderRadius: 99,
    alignItems: "center",
    justifyContent: "center"
  },

  // Summary card
  summaryCard: {
    marginTop: 20,
    padding: 16,
    backgroundColor: "#f0fdf4",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#bbf7d0"
  },
  summaryHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    marginBottom: 12
  },
  summaryTitle: { fontSize: 14, fontWeight: "700", color: "#15803d" },
  summaryRow: { flexDirection: "row", marginBottom: 10 },
  summaryGoalLine: { fontSize: 12, color: "#64748b", fontWeight: "500" },

  // Reassurance
  reassuranceRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 16,
    paddingHorizontal: 4
  },
  reassuranceText: { fontSize: 12, color: "#94a3b8", fontWeight: "500", flex: 1 },

  // Fixed CTA
  ctaWrap: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 34,
    backgroundColor: "#fff",
    borderTopWidth: 1,
    borderTopColor: "#f1f5f9",
    gap: 8
  },
  ctaBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: colors.primary,
    paddingVertical: 16,
    borderRadius: 16
  },
  ctaBtnFinish: { backgroundColor: "#10b981" },
  ctaBtnDisabled: { opacity: 0.5 },
  ctaBtnText: { color: "white", fontSize: 16, fontWeight: "800" },
  ctaSubtext: { textAlign: "center", fontSize: 12, color: "#94a3b8", fontWeight: "500" }
});