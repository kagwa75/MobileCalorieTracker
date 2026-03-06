import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
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
import { AppScreen } from "@/components/layout/AppScreen";
import { AppCard } from "@/components/ui/AppCard";
import { AppButton } from "@/components/ui/AppButton";
import { colors, radius } from "@/theme/tokens";

const genderOptions: Array<{ value: Gender; label: string; icon: keyof typeof MaterialCommunityIcons.glyphMap }> = [
  { value: "male", label: "Male", icon: "gender-male" },
  { value: "female", label: "Female", icon: "gender-female" },
  { value: "non_binary", label: "Non-binary", icon: "gender-transgender" }
];

const activityOptions: Array<{
  value: ActivityLevel;
  label: string;
  subtitle: string;
}> = [
  { value: "sedentary", label: "Sedentary", subtitle: "Desk job, little exercise" },
  { value: "light", label: "Light", subtitle: "1-3 active days per week" },
  { value: "moderate", label: "Moderate", subtitle: "3-5 active days per week" },
  { value: "active", label: "Active", subtitle: "Hard training most days" },
  { value: "very_active", label: "Very active", subtitle: "Athlete-level volume" }
];

const goalOptions: Array<{
  value: Goal;
  label: string;
  subtitle: string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
}> = [
  { value: "lose", label: "Lose weight", subtitle: "Moderate calorie deficit", icon: "trending-down" },
  { value: "maintain", label: "Maintain weight", subtitle: "Keep current body weight", icon: "scale-balance" },
  { value: "gain", label: "Gain weight", subtitle: "Lean mass focused surplus", icon: "trending-up" }
];

const targetPaceOptions: Array<{ value: TargetPace; label: string; subtitle: string }> = [
  { value: "slow", label: "Slow", subtitle: "Gentle weekly change" },
  { value: "medium", label: "Medium", subtitle: "Balanced pace" },
  { value: "aggressive", label: "Aggressive", subtitle: "Faster weekly change" }
];

const dietaryPreferenceOptions: Array<{ value: DietaryPreference; label: string }> = [
  { value: "balanced", label: "Balanced" },
  { value: "high_protein", label: "High protein" },
  { value: "low_carb", label: "Low carb" },
  { value: "vegetarian", label: "Vegetarian" },
  { value: "vegan", label: "Vegan" }
];

const minAge = 13;
const maxAge = 120;
const minWeight = 25;
const maxWeight = 400;
const minHeight = 90;
const maxHeight = 250;

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

  const delta =
    goal === "lose"
      ? targetPace === "slow"
        ? -3
        : targetPace === "aggressive"
          ? -9
          : -6
      : targetPace === "slow"
        ? 2
        : targetPace === "aggressive"
          ? 6
          : 4;

  return Math.max(25, Number((currentWeight + delta).toFixed(1)));
}

export default function OnboardingScreen() {
  const { user } = useAuth();
  const { data: profile, isLoading: profileLoading } = useProfile();
  const updateProfile = useUpdateProfile();
  const calorieTargetRpc = useCalorieTargetRpc();
  const upsertWeight = useUpsertWeightCheckin();

  const [hydrated, setHydrated] = useState(false);
  const [age, setAge] = useState("");
  const [weightKg, setWeightKg] = useState("");
  const [heightCm, setHeightCm] = useState("");
  const [gender, setGender] = useState<Gender>("female");
  const [activityLevel, setActivityLevel] = useState<ActivityLevel>("moderate");
  const [goal, setGoal] = useState<Goal>("maintain");
  const [targetPace, setTargetPace] = useState<TargetPace>("medium");
  const [dietaryPreference, setDietaryPreference] = useState<DietaryPreference>("balanced");

  useEffect(() => {
    if (hydrated || !profile) return;

    if (profile.age) setAge(String(profile.age));
    if (profile.weight_kg) setWeightKg(String(profile.weight_kg));
    if (profile.height_cm) setHeightCm(String(profile.height_cm));
    if (profile.gender && genderValues.includes(profile.gender)) setGender(profile.gender);
    if (profile.activity_level && activityLevelValues.includes(profile.activity_level)) {
      setActivityLevel(profile.activity_level);
    }
    if (profile.goal && goalValues.includes(profile.goal)) setGoal(profile.goal);
    if (profile.target_pace && targetPaceValues.includes(profile.target_pace)) setTargetPace(profile.target_pace);
    if (profile.dietary_preference && dietaryPreferenceValues.includes(profile.dietary_preference)) {
      setDietaryPreference(profile.dietary_preference);
    }

    setHydrated(true);
  }, [hydrated, profile]);

  const parsedAge = parseBoundedInteger(age, minAge, maxAge);
  const parsedWeight = parseBoundedNumber(weightKg, minWeight, maxWeight);
  const parsedHeight = parseBoundedNumber(heightCm, minHeight, maxHeight);

  const projectedCalories = useMemo(() => {
    if (!parsedAge || !parsedWeight || !parsedHeight) return null;

    return calculateDailyCalorieTarget({
      age: parsedAge,
      weightKg: parsedWeight,
      heightCm: parsedHeight,
      gender,
      activityLevel,
      goal,
      targetPace
    });
  }, [parsedAge, parsedWeight, parsedHeight, gender, activityLevel, goal, targetPace]);
  const projectedMacros = useMemo(() => {
    if (!projectedCalories || !parsedWeight) return null;

    return calculateDailyMacroTargets({
      dailyCalories: projectedCalories,
      goal,
      weightKg: parsedWeight,
      dietaryPreference
    });
  }, [projectedCalories, parsedWeight, goal, dietaryPreference]);

  if (!user) return <Redirect href="/(auth)/sign-in" />;
  if (profileLoading) {
    return (
      <AppScreen scroll={false}>
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </AppScreen>
    );
  }
  if (isOnboardingComplete(profile)) return <Redirect href="/(tabs)/dashboard" />;

  const onFinish = async () => {
    const validationError = validateOnboardingInput({
      age: parsedAge,
      weightKg: parsedWeight,
      heightCm: parsedHeight,
      gender,
      activityLevel,
      goal,
      targetPace
    });
    if (validationError) {
      Alert.alert("Invalid onboarding input", validationError);
      return;
    }
    if (!parsedAge || !parsedWeight || !parsedHeight) return;

    try {
      const rpcTarget = await calorieTargetRpc.mutateAsync({
        age: parsedAge,
        weightKg: parsedWeight,
        heightCm: parsedHeight,
        gender,
        activityLevel,
        goal,
        targetPace
      });
      const dailyTarget = rpcTarget.daily_calories;

      await updateProfile.mutateAsync({
        age: parsedAge,
        weight_kg: Number(parsedWeight.toFixed(1)),
        height_cm: Number(parsedHeight.toFixed(1)),
        gender,
        activity_level: activityLevel,
        goal,
        target_pace: targetPace,
        dietary_preference: dietaryPreference,
        timezone_name: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        daily_calorie_goal: dailyTarget,
        baseline_calorie_goal: dailyTarget,
        target_weight_kg: getSuggestedTargetWeight(parsedWeight, goal, targetPace),
        last_target_recalculated_on: formatDateKey(new Date()),
        onboarding_completed_at: new Date().toISOString()
      });
      await upsertWeight.mutateAsync({
        date: formatDateKey(new Date()),
        weightKg: parsedWeight
      });

      router.replace("/(tabs)/dashboard");
    } catch (error) {
      void captureClientError(error, { screen: "onboarding", action: "save-profile" });
      Alert.alert("Could not save profile", error instanceof Error ? error.message : "Please try again.");
    }
  };

  return (
    <AppScreen>
      <View style={styles.header}>
        <View style={styles.headerBadge}>
          <MaterialCommunityIcons name="rocket-launch-outline" size={16} color={colors.primary} />
          <Text style={styles.headerBadgeText}>Onboarding</Text>
        </View>
        <Text style={styles.title}>Set up your nutrition profile</Text>
        <Text style={styles.subtitle}>We’ll personalize your daily calories and meal targets.</Text>
      </View>

      <AppCard style={styles.heroCard}>
        <View>
          <Text style={styles.heroLabel}>Projected daily target</Text>
          <Text style={styles.heroValue}>{projectedCalories ?? "--"}</Text>
          <Text style={styles.heroUnit}>kcal / day</Text>
          {projectedMacros ? (
            <Text style={styles.heroMacro}>
              P {projectedMacros.proteinGrams}g • C {projectedMacros.carbsGrams}g • F {projectedMacros.fatGrams}g
            </Text>
          ) : null}
        </View>
        <MaterialCommunityIcons name="target" size={28} color="#8ed9ff" />
      </AppCard>

      <AppCard style={{ marginTop: 10 }}>
        <Text style={styles.sectionTitle}>Body metrics</Text>
        <View style={styles.row}>
          <View style={styles.fieldHalf}>
            <Text style={styles.label}>Age</Text>
            <TextInput
              value={age}
              onChangeText={setAge}
              keyboardType="numeric"
              placeholder="25"
              placeholderTextColor="#8ea0ba"
              style={styles.input}
            />
          </View>
          <View style={styles.fieldHalf}>
            <Text style={styles.label}>Weight (kg)</Text>
            <TextInput
              value={weightKg}
              onChangeText={setWeightKg}
              keyboardType="decimal-pad"
              placeholder="72.5"
              placeholderTextColor="#8ea0ba"
              style={styles.input}
            />
          </View>
        </View>

        <Text style={styles.label}>Height (cm)</Text>
        <TextInput
          value={heightCm}
          onChangeText={setHeightCm}
          keyboardType="decimal-pad"
          placeholder="175"
          placeholderTextColor="#8ea0ba"
          style={styles.input}
        />

        <Text style={[styles.sectionTitle, { marginTop: 10 }]}>Gender</Text>
        <View style={styles.pillWrap}>
          {genderOptions.map((item) => (
            <Pressable
              key={item.value}
              onPress={() => setGender(item.value)}
              style={[styles.pill, gender === item.value && styles.pillSelected]}
            >
              <MaterialCommunityIcons
                name={item.icon}
                size={16}
                color={gender === item.value ? colors.primary : colors.mutedText}
              />
              <Text style={[styles.pillText, gender === item.value && styles.pillTextSelected]}>{item.label}</Text>
            </Pressable>
          ))}
        </View>
      </AppCard>

      <AppCard style={{ marginTop: 10 }}>
        <Text style={styles.sectionTitle}>Lifestyle & goals</Text>

        <Text style={styles.label}>Activity level</Text>
        <View style={styles.selectWrap}>
          {activityOptions.map((item) => (
            <Pressable
              key={item.value}
              onPress={() => setActivityLevel(item.value)}
              style={[styles.selectItem, activityLevel === item.value && styles.selectItemActive]}
            >
              <Text style={[styles.selectTitle, activityLevel === item.value && styles.selectTitleActive]}>{item.label}</Text>
              <Text style={[styles.selectSubtitle, activityLevel === item.value && styles.selectSubtitleActive]}>
                {item.subtitle}
              </Text>
            </Pressable>
          ))}
        </View>

        <Text style={[styles.label, { marginTop: 12 }]}>Goal</Text>
        <View style={styles.selectWrap}>
          {goalOptions.map((item) => (
            <Pressable
              key={item.value}
              onPress={() => setGoal(item.value)}
              style={[styles.selectItem, goal === item.value && styles.selectItemActive]}
            >
              <View style={styles.goalRow}>
                <MaterialCommunityIcons
                  name={item.icon}
                  size={16}
                  color={goal === item.value ? colors.primary : colors.mutedText}
                />
                <Text style={[styles.selectTitle, goal === item.value && styles.selectTitleActive]}>{item.label}</Text>
              </View>
              <Text style={[styles.selectSubtitle, goal === item.value && styles.selectSubtitleActive]}>
                {item.subtitle}
              </Text>
            </Pressable>
          ))}
        </View>

        <Text style={[styles.label, { marginTop: 12 }]}>Target pace</Text>
        <View style={styles.selectWrap}>
          {targetPaceOptions.map((item) => (
            <Pressable
              key={item.value}
              onPress={() => setTargetPace(item.value)}
              style={[styles.selectItem, targetPace === item.value && styles.selectItemActive]}
            >
              <Text style={[styles.selectTitle, targetPace === item.value && styles.selectTitleActive]}>{item.label}</Text>
              <Text style={[styles.selectSubtitle, targetPace === item.value && styles.selectSubtitleActive]}>
                {item.subtitle}
              </Text>
            </Pressable>
          ))}
        </View>

        <Text style={[styles.label, { marginTop: 12 }]}>Diet preference</Text>
        <View style={styles.pillWrap}>
          {dietaryPreferenceOptions.map((item) => (
            <Pressable
              key={item.value}
              onPress={() => setDietaryPreference(item.value)}
              style={[styles.pill, dietaryPreference === item.value && styles.pillSelected]}
            >
              <Text style={[styles.pillText, dietaryPreference === item.value && styles.pillTextSelected]}>{item.label}</Text>
            </Pressable>
          ))}
        </View>
      </AppCard>

      <AppButton
        label={updateProfile.isPending || calorieTargetRpc.isPending ? "Saving profile..." : "Finish setup"}
        onPress={onFinish}
        disabled={updateProfile.isPending || calorieTargetRpc.isPending}
        style={{ marginTop: 12 }}
      />

      <View style={{ height: 26 }} />
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  loadingWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center"
  },
  header: {
    marginTop: 8,
    marginBottom: 4
  },
  headerBadge: {
    backgroundColor: colors.primarySoft,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    alignSelf: "flex-start"
  },
  headerBadgeText: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: "700"
  },
  title: {
    marginTop: 10,
    color: colors.text,
    fontSize: 28,
    fontWeight: "800",
    lineHeight: 32
  },
  subtitle: {
    marginTop: 4,
    color: colors.mutedText
  },
  heroCard: {
    marginTop: 12,
    backgroundColor: "#102f50",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center"
  },
  heroLabel: {
    color: "#b5cce6",
    fontWeight: "700",
    fontSize: 12
  },
  heroValue: {
    color: "white",
    fontSize: 36,
    fontWeight: "800",
    marginTop: 2
  },
  heroUnit: {
    color: "#b5cce6",
    fontSize: 12,
    fontWeight: "600"
  },
  heroMacro: {
    marginTop: 4,
    color: "#d5e3f3",
    fontSize: 12,
    fontWeight: "700"
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "800",
    marginBottom: 8
  },
  row: {
    flexDirection: "row",
    gap: 10
  },
  fieldHalf: {
    flex: 1
  },
  label: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "600",
    marginBottom: 5,
    marginTop: 3
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 15,
    color: colors.text,
    backgroundColor: "#f8fbff"
  },
  pillWrap: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap"
  },
  pill: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 9,
    backgroundColor: "#f8fbff",
    flexDirection: "row",
    alignItems: "center",
    gap: 6
  },
  pillSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft
  },
  pillText: {
    color: colors.mutedText,
    fontWeight: "700",
    fontSize: 13
  },
  pillTextSelected: {
    color: colors.primary
  },
  selectWrap: {
    gap: 8
  },
  selectItem: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: "#f8fbff",
    paddingHorizontal: 12,
    paddingVertical: 11
  },
  selectItemActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft
  },
  selectTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "700"
  },
  selectTitleActive: {
    color: colors.primary
  },
  selectSubtitle: {
    color: colors.mutedText,
    fontSize: 12,
    marginTop: 2
  },
  selectSubtitleActive: {
    color: colors.primary
  },
  goalRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6
  }
});
