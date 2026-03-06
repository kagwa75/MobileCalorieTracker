import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import {
  calculateDailyMacroTargets,
  dietaryPreferenceValues,
  targetPaceValues,
  type DietaryPreference,
  type TargetPace
} from "@/lib/calorieTarget";
import { captureClientError } from "@/lib/monitoring";
import { useAuth } from "@/providers/AuthProvider";
import { useProfile, useRecomputeProfileCalorieTarget, useUpdateProfile } from "@/hooks/useProfile";
import { useAdaptiveCalorieRecalculation, useUpsertWeightCheckin } from "@/hooks/useWeights";
import { useReminderPreferences, useUpdateReminderPreferences } from "@/hooks/useReminders";
import { formatDateKey } from "@/lib/date";
import { validateProfileWriteInput } from "@/lib/flowValidation";
import { AppScreen } from "@/components/layout/AppScreen";
import { AppButton } from "@/components/ui/AppButton";
import { AppCard } from "@/components/ui/AppCard";
import { AdBanner } from "@/components/ads/AdBanner";
import { useAds } from "@/providers/AdsProvider";
import { colors, radius } from "@/theme/tokens";

export default function ProfileScreen() {
  const { user, signOut } = useAuth();
  const { data: profile, isLoading } = useProfile();
  const updateProfile = useUpdateProfile();
  const recomputeTarget = useRecomputeProfileCalorieTarget();
  const adaptiveRecalculate = useAdaptiveCalorieRecalculation();
  const upsertWeight = useUpsertWeightCheckin();
  const { data: reminderPrefs } = useReminderPreferences();
  const updateReminderPrefs = useUpdateReminderPreferences();
  const { isSupported: adsSupported, isInitializing: adsInitializing, privacyOptionsRequired, showPrivacyOptions } = useAds();

  const [displayName, setDisplayName] = useState("");
  const [calorieGoal, setCalorieGoal] = useState("2000");
  const [targetPace, setTargetPace] = useState<TargetPace>("medium");
  const [dietaryPreference, setDietaryPreference] = useState<DietaryPreference>("balanced");
  const [adaptiveEnabled, setAdaptiveEnabled] = useState(true);
  const [weightCheckin, setWeightCheckin] = useState("");
  const [targetWeight, setTargetWeight] = useState("");
  const [quietStart, setQuietStart] = useState("22:00");
  const [quietEnd, setQuietEnd] = useState("06:00");
  const [remindersEnabled, setRemindersEnabled] = useState(true);
  const parsedGoal = Number.parseInt(calorieGoal, 10);
  const previewGoal = Number.isFinite(parsedGoal) ? parsedGoal : profile?.daily_calorie_goal ?? 2000;
  const profileWeightKg = Number(profile?.weight_kg ?? NaN);
  const macroTargets = calculateDailyMacroTargets({
    dailyCalories: previewGoal,
    goal: profile?.goal,
    weightKg: Number.isFinite(profileWeightKg) ? profileWeightKg : null,
    dietaryPreference
  });

  useEffect(() => {
    if (!profile) return;
    setDisplayName(profile.display_name || "");
    setCalorieGoal(String(profile.daily_calorie_goal || 2000));
    if (profile.target_pace && targetPaceValues.includes(profile.target_pace)) setTargetPace(profile.target_pace);
    if (profile.dietary_preference && dietaryPreferenceValues.includes(profile.dietary_preference)) {
      setDietaryPreference(profile.dietary_preference);
    }
    setAdaptiveEnabled(profile.adaptive_calorie_target_enabled ?? true);
    if (profile.weight_kg) setWeightCheckin(String(profile.weight_kg));
    if (profile.target_weight_kg) setTargetWeight(String(profile.target_weight_kg));
  }, [profile]);

  useEffect(() => {
    if (!reminderPrefs) return;
    setQuietStart(reminderPrefs.quiet_hours_start.slice(0, 5));
    setQuietEnd(reminderPrefs.quiet_hours_end.slice(0, 5));
    setRemindersEnabled(reminderPrefs.enabled);
  }, [reminderPrefs]);

  const onSave = async () => {
    const goalValue = Number.parseInt(calorieGoal, 10);
    const parsedTargetWeight = Number.parseFloat(targetWeight.replace(",", "."));
    const normalizedTargetWeight = Number.isFinite(parsedTargetWeight) ? parsedTargetWeight : null;
    const trimmedWeightCheckin = weightCheckin.trim();
    const parsedWeightCheckin = Number.parseFloat(trimmedWeightCheckin.replace(",", "."));
    const hasWeightCheckinInput = trimmedWeightCheckin.length > 0;
    const isWeightCheckinValid =
      Number.isFinite(parsedWeightCheckin) && parsedWeightCheckin >= 25 && parsedWeightCheckin <= 400;
    const validationError = validateProfileWriteInput({
      calorieGoal: goalValue,
      quietStart,
      quietEnd,
      targetWeightKg: normalizedTargetWeight
    });
    if (validationError) {
      Alert.alert("Invalid profile values", validationError);
      return;
    }
    if (hasWeightCheckinInput && !isWeightCheckinValid) {
      Alert.alert("Invalid weight check-in", "Enter a value between 25 and 400 kg.");
      return;
    }

    try {
      await updateProfile.mutateAsync({
        display_name: displayName.trim(),
        daily_calorie_goal: goalValue,
        target_pace: targetPace,
        dietary_preference: dietaryPreference,
        adaptive_calorie_target_enabled: adaptiveEnabled,
        target_weight_kg: normalizedTargetWeight || profile?.target_weight_kg || undefined,
        weight_kg: isWeightCheckinValid ? Number(parsedWeightCheckin.toFixed(1)) : undefined
      });

      await updateReminderPrefs.mutateAsync({
        enabled: remindersEnabled,
        quiet_hours_start: quietStart,
        quiet_hours_end: quietEnd,
        timezone_name: profile?.timezone_name || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
      });

      if (isWeightCheckinValid) {
        await upsertWeight.mutateAsync({
          date: formatDateKey(new Date()),
          weightKg: parsedWeightCheckin
        });
      }

      Alert.alert("Saved", "Profile updated successfully.");
    } catch (error) {
      void captureClientError(error, { screen: "profile", action: "update-profile" });
      Alert.alert("Save failed", error instanceof Error ? error.message : "Could not update profile");
    }
  };

  const onRecomputeTarget = async () => {
    try {
      await recomputeTarget.mutateAsync(undefined);
      Alert.alert("Target updated", "Your calorie target was recalculated from your profile settings.");
    } catch (error) {
      void captureClientError(error, { screen: "profile", action: "recompute-target" });
      Alert.alert("Recompute failed", error instanceof Error ? error.message : "Could not recompute target");
    }
  };

  const onRunAdaptiveNow = async () => {
    try {
      const result = await adaptiveRecalculate.mutateAsync(undefined);
      if (!result) {
        Alert.alert("Adaptive target", "No update was needed this week.");
        return;
      }
      if (!result.adjustment) {
        Alert.alert(
          "Adaptive target",
          `No adjustment this run. Weekly trend ${result.weekly_weight_change.toFixed(2)} kg vs expected ${result.expected_weekly_change.toFixed(2)} kg/week.`
        );
        return;
      }
      Alert.alert(
        "Adaptive target",
        `Target ${result.adjustment >= 0 ? "increased" : "decreased"} by ${Math.abs(result.adjustment)} kcal. Trend ${result.weekly_weight_change.toFixed(2)} kg/week.`
      );
    } catch (error) {
      void captureClientError(error, { screen: "profile", action: "adaptive-recalculate" });
      Alert.alert("Adaptive update failed", error instanceof Error ? error.message : "Please try again.");
    }
  };

  const onSignOut = async () => {
    try {
      await signOut();
    } catch (error) {
      void captureClientError(error, { screen: "profile", action: "sign-out" });
      Alert.alert("Sign out failed", "Please try again.");
    }
  };

  const onManageAdPrivacy = async () => {
    try {
      const opened = await showPrivacyOptions();
      if (opened) return;
      Alert.alert("Ad privacy", "No ad privacy options are required for your region right now.");
    } catch (error) {
      void captureClientError(error, { screen: "profile", action: "manage-ad-privacy" });
      Alert.alert("Ad privacy", "Could not open ad privacy options right now.");
    }
  };

  if (isLoading) {
    return (
      <AppScreen scroll={false}>
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </AppScreen>
    );
  }

  return (
    <AppScreen>
      <View style={styles.header}>
        <Text style={styles.title}>Profile</Text>
        <View style={styles.headerPill}>
          <MaterialCommunityIcons name="account" size={14} color={colors.primary} />
          <Text style={styles.headerPillText}>Account</Text>
        </View>
      </View>
      <AdBanner />

      <AppCard style={{ marginBottom: 10 }}>
        <Text style={styles.sectionTitle}>Account details</Text>

        <Text style={styles.label}>Email</Text>
        <View style={styles.readonlyField}>
          <Text style={styles.readonlyText}>{user?.email || "-"}</Text>
        </View>

        <Text style={styles.label}>Display name</Text>
        <TextInput
          value={displayName}
          onChangeText={setDisplayName}
          placeholder="Your name"
          placeholderTextColor="#8ea0ba"
          style={styles.input}
        />
        {adsSupported ? (
          <>
            <AppButton
              label={adsInitializing ? "Loading ad privacy..." : "Manage ad privacy choices"}
              onPress={() => void onManageAdPrivacy()}
              disabled={adsInitializing}
              variant="outline"
              style={{ marginTop: 10 }}
            />
            {privacyOptionsRequired ? <Text style={styles.policyHint}>Required by your region's privacy rules.</Text> : null}
          </>
        ) : null}
      </AppCard>

      <AppCard style={{ marginBottom: 12 }}>
        <Text style={styles.sectionTitle}>Nutrition goal</Text>
        <Text style={styles.label}>Daily calorie target</Text>
        <TextInput
          value={calorieGoal}
          onChangeText={setCalorieGoal}
          keyboardType="numeric"
          placeholder="2000"
          placeholderTextColor="#8ea0ba"
          style={styles.input}
        />
        <Text style={styles.macroHint}>
          Macro targets: P {macroTargets.proteinGrams}g • C {macroTargets.carbsGrams}g • F {macroTargets.fatGrams}g
        </Text>

        <Text style={[styles.label, { marginTop: 10 }]}>Target pace</Text>
        <View style={styles.pillWrap}>
          {targetPaceValues.map((pace) => (
            <Pressable key={pace} onPress={() => setTargetPace(pace)} style={[styles.pill, targetPace === pace && styles.pillSelected]}>
              <Text style={[styles.pillText, targetPace === pace && styles.pillTextSelected]}>{pace}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={[styles.label, { marginTop: 10 }]}>Dietary preference</Text>
        <View style={styles.pillWrap}>
          {dietaryPreferenceValues.map((value) => (
            <Pressable
              key={value}
              onPress={() => setDietaryPreference(value)}
              style={[styles.pill, dietaryPreference === value && styles.pillSelected]}
            >
              <Text style={[styles.pillText, dietaryPreference === value && styles.pillTextSelected]}>
                {value.replace("_", " ")}
              </Text>
            </Pressable>
          ))}
        </View>

        <Text style={[styles.label, { marginTop: 10 }]}>Today weight check-in (kg)</Text>
        <TextInput
          value={weightCheckin}
          onChangeText={setWeightCheckin}
          keyboardType="decimal-pad"
          placeholder="72.5"
          placeholderTextColor="#8ea0ba"
          style={styles.input}
        />

        <Text style={[styles.label, { marginTop: 10 }]}>Goal target weight (kg)</Text>
        <TextInput
          value={targetWeight}
          onChangeText={setTargetWeight}
          keyboardType="decimal-pad"
          placeholder="68.0"
          placeholderTextColor="#8ea0ba"
          style={styles.input}
        />

        <Pressable style={styles.toggleRow} onPress={() => setAdaptiveEnabled((prev) => !prev)}>
          <Text style={styles.toggleLabel}>Adaptive weekly calorie target</Text>
          <Text style={styles.toggleValue}>{adaptiveEnabled ? "On" : "Off"}</Text>
        </Pressable>

        <AppButton
          label={recomputeTarget.isPending ? "Recomputing..." : "Recompute from profile"}
          onPress={onRecomputeTarget}
          disabled={recomputeTarget.isPending}
          variant="outline"
          style={{ marginTop: 10 }}
        />
        <AppButton
          label={adaptiveRecalculate.isPending ? "Updating..." : "Run adaptive weekly adjustment"}
          onPress={onRunAdaptiveNow}
          disabled={adaptiveRecalculate.isPending}
          variant="outline"
          style={{ marginTop: 8 }}
        />
      </AppCard>

      <AppCard style={{ marginBottom: 12 }}>
        <Text style={styles.sectionTitle}>Reminder habit loop</Text>
        <Pressable style={styles.toggleRow} onPress={() => setRemindersEnabled((prev) => !prev)}>
          <Text style={styles.toggleLabel}>Meal reminders</Text>
          <Text style={styles.toggleValue}>{remindersEnabled ? "On" : "Off"}</Text>
        </Pressable>
        <Text style={styles.label}>Quiet start (HH:MM)</Text>
        <TextInput value={quietStart} onChangeText={setQuietStart} placeholder="22:00" placeholderTextColor="#8ea0ba" style={styles.input} />
        <Text style={styles.label}>Quiet end (HH:MM)</Text>
        <TextInput value={quietEnd} onChangeText={setQuietEnd} placeholder="06:00" placeholderTextColor="#8ea0ba" style={styles.input} />
      </AppCard>

      <AppButton
        label={updateProfile.isPending ? "Saving..." : "Save changes"}
        onPress={onSave}
        disabled={updateProfile.isPending}
        style={{ marginBottom: 10 }}
      />

      <AppButton label="Sign out" onPress={onSignOut} variant="danger" />

      <View style={{ height: 90 }} />
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
    marginBottom: 10,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center"
  },
  title: {
    fontSize: 28,
    fontWeight: "800",
    color: colors.text
  },
  headerPill: {
    backgroundColor: colors.primarySoft,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.pill,
    flexDirection: "row",
    alignItems: "center",
    gap: 4
  },
  headerPillText: {
    color: colors.primary,
    fontWeight: "700",
    fontSize: 12
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "800",
    marginBottom: 8
  },
  policyHint: {
    marginTop: 8,
    color: colors.mutedText,
    fontSize: 12,
    fontWeight: "500"
  },
  label: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "600",
    marginBottom: 5,
    marginTop: 3
  },
  readonlyField: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: "#f4f8ff",
    marginBottom: 6
  },
  readonlyText: {
    color: colors.mutedText
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
  macroHint: {
    marginTop: 8,
    color: colors.mutedText,
    fontSize: 12,
    fontWeight: "600"
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
    paddingVertical: 7,
    paddingHorizontal: 10,
    backgroundColor: "#f8fbff"
  },
  pillSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft
  },
  pillText: {
    color: colors.mutedText,
    fontWeight: "600",
    textTransform: "capitalize"
  },
  pillTextSelected: {
    color: colors.primary
  },
  toggleRow: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 11,
    flexDirection: "row",
    justifyContent: "space-between"
  },
  toggleLabel: {
    color: colors.text,
    fontWeight: "600"
  },
  toggleValue: {
    color: colors.primary,
    fontWeight: "700"
  }
});
