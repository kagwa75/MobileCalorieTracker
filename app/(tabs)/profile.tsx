import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
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
import { AppCard } from "@/components/ui/AppCard";
import { AdBanner } from "@/components/ads/AdBanner";
import { LoadFailureCard } from "@/components/ui/LoadFailureCard";
import { useAds } from "@/providers/AdsProvider";
import { colors, radius } from "@/theme/tokens";
import { useRouter } from "expo-router";

const dietaryIcons: Record<string, keyof typeof MaterialCommunityIcons.glyphMap> = {
  balanced: "scale-balance",
  high_protein: "arm-flex-outline",
  low_carb: "bread-slice-outline",
  vegan: "leaf",
  vegetarian: "sprout-outline"
};

const paceDescriptions: Record<string, string> = {
  slow: "~0.25 kg/week",
  medium: "~0.5 kg/week",
  fast: "~0.75 kg/week"
};

export default function ProfileScreen() {
  const { user, signOut } = useAuth();
  const profileQuery = useProfile();
  const profile = profileQuery.data;
  const isLoading = profileQuery.isLoading;
  const updateProfile = useUpdateProfile();
  const recomputeTarget = useRecomputeProfileCalorieTarget();
  const adaptiveRecalculate = useAdaptiveCalorieRecalculation();
  const upsertWeight = useUpsertWeightCheckin();
  const reminderPrefsQuery = useReminderPreferences();
  const reminderPrefs = reminderPrefsQuery.data;
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

  const isRefreshing = profileQuery.isRefetching || reminderPrefsQuery.isRefetching;
  const handleRefresh = useCallback(() => {
    void Promise.all([profileQuery.refetch(), reminderPrefsQuery.refetch()]);
  }, [profileQuery, reminderPrefsQuery]);

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
    if (validationError) { Alert.alert("Invalid profile values", validationError); return; }
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
        await upsertWeight.mutateAsync({ date: formatDateKey(new Date()), weightKg: parsedWeightCheckin });
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
      if (!result) { Alert.alert("Adaptive target", "No update was needed this week."); return; }
      if (!result.adjustment) {
        Alert.alert("Adaptive target", `No adjustment this run. Weekly trend ${result.weekly_weight_change.toFixed(2)} kg vs expected ${result.expected_weekly_change.toFixed(2)} kg/week.`);
        return;
      }
      Alert.alert("Adaptive target", `Target ${result.adjustment >= 0 ? "increased" : "decreased"} by ${Math.abs(result.adjustment)} kcal. Trend ${result.weekly_weight_change.toFixed(2)} kg/week.`);
    } catch (error) {
      void captureClientError(error, { screen: "profile", action: "adaptive-recalculate" });
      Alert.alert("Adaptive update failed", error instanceof Error ? error.message : "Please try again.");
    }
  };

  const onSignOut = async () => {
    try { await signOut(); }
    catch (error) {
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
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={styles.loadingText}>Loading profile…</Text>
        </View>
      </AppScreen>
    );
  }

  const initials = (displayName || user?.email || "?").slice(0, 2).toUpperCase();
  const router = useRouter();
  if (profileQuery.isError && !profile) {
    return (
      <AppScreen>
        <View style={styles.header}>
          <Text style={styles.title}>Profile</Text>
        </View>
        <LoadFailureCard
          title="Profile unavailable"
          message="We couldn't load your profile details. Pull down or tap retry once your connection is back."
          onAction={handleRefresh}
        />
      </AppScreen>
    );
  }

  return (
    <AppScreen onRefresh={handleRefresh} refreshing={isRefreshing}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Profile</Text>
      </View>

      {/* Avatar + account banner */}
      <View style={styles.accountBanner}>
        <TouchableOpacity onPress={() => router.push("/onboarding")} style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 12 }}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials}</Text>
          </View>
          <View style={styles.accountInfo}>
            <Text style={styles.accountName}>{displayName || "Set your name"}</Text>
            <Text style={styles.accountEmail}>{user?.email || ""}</Text>
          </View>
        </TouchableOpacity>
        {adsSupported && (
          <Pressable
            onPress={() => void onManageAdPrivacy()}
            disabled={adsInitializing}
            style={styles.privacyBtn}
          >
            <MaterialCommunityIcons name="shield-check-outline" size={16} color="#64748b" />
          </Pressable>
        )}
      </View>

      {/* Account details */}
      <AppCard style={styles.card}>
        <SectionHeader icon="account-edit-outline" title="Account" />

        <FieldLabel>Display name</FieldLabel>
        <TextInput
          value={displayName}
          onChangeText={setDisplayName}
          placeholder="Your name"
          placeholderTextColor="#94a3b8"
          style={styles.input}
        />
      </AppCard>

      {/* Nutrition goal */}
      <AppCard style={styles.card}>
        <SectionHeader icon="bullseye-arrow" title="Nutrition goal" />

        <FieldLabel>Daily calorie target</FieldLabel>
        <View style={styles.calorieInputRow}>
          <TextInput
            value={calorieGoal}
            onChangeText={setCalorieGoal}
            keyboardType="numeric"
            placeholder="2000"
            placeholderTextColor="#94a3b8"
            style={[styles.input, { flex: 1, marginBottom: 0 }]}
          />
          <View style={styles.kcalBadge}>
            <Text style={styles.kcalBadgeText}>kcal</Text>
          </View>
        </View>

        {/* Macro preview */}
        <View style={styles.macroPillRow}>
          <View style={[styles.macroPill, { backgroundColor: "#dbeafe" }]}>
            <Text style={[styles.macroPillLabel, { color: "#1d4ed8" }]}>P</Text>
            <Text style={[styles.macroPillValue, { color: "#1d4ed8" }]}>{macroTargets.proteinGrams}g</Text>
          </View>
          <View style={[styles.macroPill, { backgroundColor: "#d1fae5" }]}>
            <Text style={[styles.macroPillLabel, { color: "#065f46" }]}>C</Text>
            <Text style={[styles.macroPillValue, { color: "#065f46" }]}>{macroTargets.carbsGrams}g</Text>
          </View>
          <View style={[styles.macroPill, { backgroundColor: "#fef3c7" }]}>
            <Text style={[styles.macroPillLabel, { color: "#92400e" }]}>F</Text>
            <Text style={[styles.macroPillValue, { color: "#92400e" }]}>{macroTargets.fatGrams}g</Text>
          </View>
          <Text style={styles.macroPillHint}>Estimated daily macros</Text>
        </View>

        {/* Target pace */}
        <FieldLabel>Target pace</FieldLabel>
        <View style={styles.optionGrid}>
          {targetPaceValues.map((pace) => (
            <Pressable
              key={pace}
              onPress={() => setTargetPace(pace)}
              style={[styles.optionCard, targetPace === pace && styles.optionCardSelected]}
            >
              <Text style={[styles.optionCardTitle, targetPace === pace && styles.optionCardTitleSelected]}>
                {pace.charAt(0).toUpperCase() + pace.slice(1)}
              </Text>
              <Text style={[styles.optionCardSub, targetPace === pace && styles.optionCardSubSelected]}>
                {paceDescriptions[pace]}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* Dietary preference */}
        <FieldLabel>Dietary preference</FieldLabel>
        <View style={styles.dietGrid}>
          {dietaryPreferenceValues.map((value) => {
            const isSelected = dietaryPreference === value;
            return (
              <Pressable
                key={value}
                onPress={() => setDietaryPreference(value)}
                style={[styles.dietCard, isSelected && styles.dietCardSelected]}
              >
                <MaterialCommunityIcons
                  name={dietaryIcons[value] || "food-outline"}
                  size={20}
                  color={isSelected ? colors.primary : "#94a3b8"}
                />
                <Text style={[styles.dietCardText, isSelected && styles.dietCardTextSelected]}>
                  {value.replace("_", " ")}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* Adaptive toggle */}
        <FieldLabel>Adaptive target</FieldLabel>
        <Toggle
          label="Auto-adjust calories weekly"
          hint="Adjusts based on your actual weight trend"
          value={adaptiveEnabled}
          onToggle={() => setAdaptiveEnabled((prev) => !prev)}
        />

        <View style={styles.actionBtnGroup}>
          <ActionButton
            icon="calculator-variant-outline"
            label={recomputeTarget.isPending ? "Recomputing…" : "Recompute from profile"}
            onPress={onRecomputeTarget}
            disabled={recomputeTarget.isPending}
          />
          <ActionButton
            icon="refresh"
            label={adaptiveRecalculate.isPending ? "Updating…" : "Run adaptive adjustment now"}
            onPress={onRunAdaptiveNow}
            disabled={adaptiveRecalculate.isPending}
          />
        </View>
      </AppCard>

      {/* Weight */}
      <AppCard style={styles.card}>
        <SectionHeader icon="scale-bathroom" title="Weight" />

        <View style={styles.weightRow}>
          <View style={{ flex: 1 }}>
            <FieldLabel>Today's weight (kg)</FieldLabel>
            <TextInput
              value={weightCheckin}
              onChangeText={setWeightCheckin}
              keyboardType="decimal-pad"
              placeholder="72.5"
              placeholderTextColor="#94a3b8"
              style={styles.input}
            />
          </View>
          <View style={styles.weightArrow}>
            <MaterialCommunityIcons name="arrow-right" size={16} color="#cbd5e1" />
          </View>
          <View style={{ flex: 1 }}>
            <FieldLabel>Goal weight (kg)</FieldLabel>
            <TextInput
              value={targetWeight}
              onChangeText={setTargetWeight}
              keyboardType="decimal-pad"
              placeholder="68.0"
              placeholderTextColor="#94a3b8"
              style={styles.input}
            />
          </View>
        </View>
      </AppCard>

      {/* Reminders */}
      <AppCard style={styles.card}>
        <SectionHeader icon="bell-outline" title="Reminders" />

        <Toggle
          label="Meal reminders"
          hint="Get nudged to log your meals on time"
          value={remindersEnabled}
          onToggle={() => setRemindersEnabled((prev) => !prev)}
        />

        <FieldLabel>Quiet hours</FieldLabel>
        <View style={styles.quietRow}>
          <View style={styles.quietField}>
            <Text style={styles.quietFieldLabel}>From</Text>
            <TextInput
              value={quietStart}
              onChangeText={setQuietStart}
              placeholder="22:00"
              placeholderTextColor="#94a3b8"
              style={styles.quietInput}
            />
          </View>
          <MaterialCommunityIcons name="minus" size={16} color="#cbd5e1" style={{ marginTop: 22 }} />
          <View style={styles.quietField}>
            <Text style={styles.quietFieldLabel}>Until</Text>
            <TextInput
              value={quietEnd}
              onChangeText={setQuietEnd}
              placeholder="06:00"
              placeholderTextColor="#94a3b8"
              style={styles.quietInput}
            />
          </View>
        </View>
      </AppCard>

      <AdBanner />

      {/* Save button */}
      <Pressable
        onPress={() => void onSave()}
        disabled={updateProfile.isPending}
        style={[styles.saveCta, updateProfile.isPending && styles.saveCtaDisabled]}
      >
        {updateProfile.isPending ? (
          <ActivityIndicator color="white" />
        ) : (
          <>
            <MaterialCommunityIcons name="content-save-outline" size={20} color="white" />
            <Text style={styles.saveCtaText}>Save changes</Text>
          </>
        )}
      </Pressable>

      {/* Sign out */}
      <Pressable onPress={() => void onSignOut()} style={styles.signOutBtn}>
        <MaterialCommunityIcons name="logout" size={16} color="#be123c" />
        <Text style={styles.signOutText}>Sign out</Text>
      </Pressable>

      <View style={{ height: 100 }} />
    </AppScreen>
  );
}

function SectionHeader({ icon, title }: { icon: keyof typeof MaterialCommunityIcons.glyphMap; title: string }) {
  return (
    <View style={sectionStyles.wrap}>
      <View style={sectionStyles.iconWrap}>
        <MaterialCommunityIcons name={icon} size={16} color={colors.primary} />
      </View>
      <Text style={sectionStyles.title}>{title}</Text>
    </View>
  );
}

const sectionStyles = StyleSheet.create({
  wrap: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 14 },
  iconWrap: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: `${colors.primary}15`,
    alignItems: "center",
    justifyContent: "center"
  },
  title: { fontSize: 16, fontWeight: "800", color: "#0f172a" }
});

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <Text style={styles.fieldLabel}>{children}</Text>;
}

function Toggle({ label, hint, value, onToggle }: { label: string; hint?: string; value: boolean; onToggle: () => void }) {
  return (
    <Pressable onPress={onToggle} style={styles.toggleRow}>
      <View style={styles.toggleLeft}>
        <Text style={styles.toggleLabel}>{label}</Text>
        {hint && <Text style={styles.toggleHint}>{hint}</Text>}
      </View>
      <View style={[styles.toggleTrack, value && styles.toggleTrackOn]}>
        <View style={[styles.toggleThumb, value && styles.toggleThumbOn]} />
      </View>
    </Pressable>
  );
}

function ActionButton({ icon, label, onPress, disabled }: { icon: keyof typeof MaterialCommunityIcons.glyphMap; label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[styles.actionBtn, disabled && { opacity: 0.5 }]}
    >
      <MaterialCommunityIcons name={icon} size={16} color="#64748b" />
      <Text style={styles.actionBtnText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  loadingText: { color: "#94a3b8", fontSize: 14 },

  header: { marginTop: 8, marginBottom: 14 },
  title: { fontSize: 28, fontWeight: "800", color: "#0f172a" },

  // Account banner
  accountBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 16,
    padding: 14,
    marginBottom: 12
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center"
  },
  avatarText: { color: "white", fontSize: 18, fontWeight: "800" },
  accountInfo: { flex: 1 },
  accountName: { fontSize: 16, fontWeight: "700", color: "#0f172a" },
  accountEmail: { fontSize: 12, color: "#64748b", marginTop: 2 },
  privacyBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: "#f1f5f9",
    alignItems: "center",
    justifyContent: "center"
  },

  card: { marginBottom: 12 },
  fieldLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: "#64748b",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 6,
    marginTop: 12
  },
  input: {
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: "#0f172a",
    backgroundColor: "#f8fafc",
    marginBottom: 4
  },

  // Calorie input
  calorieInputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 4
  },
  kcalBadge: {
    backgroundColor: "#f1f5f9",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: "#e2e8f0"
  },
  kcalBadgeText: { color: "#64748b", fontWeight: "700", fontSize: 13 },

  // Macro pills
  macroPillRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 4,
    marginTop: 8
  },
  macroPill: { borderRadius: 99, paddingHorizontal: 8, paddingVertical: 4, flexDirection: "row", alignItems: "center", gap: 3 },
  macroPillLabel: { fontSize: 10, fontWeight: "800" },
  macroPillValue: { fontSize: 12, fontWeight: "700" },
  macroPillHint: { flex: 1, fontSize: 10, color: "#94a3b8", fontWeight: "500", textAlign: "right" },

  // Option grid (pace)
  optionGrid: { flexDirection: "row", gap: 8, marginBottom: 4 },
  optionCard: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: "#e2e8f0",
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 8,
    alignItems: "center",
    backgroundColor: "#f8fafc"
  },
  optionCardSelected: { borderColor: colors.primary, backgroundColor: `${colors.primary}10` },
  optionCardTitle: { fontSize: 13, fontWeight: "700", color: "#64748b" },
  optionCardTitleSelected: { color: colors.primary },
  optionCardSub: { fontSize: 10, color: "#94a3b8", marginTop: 2, fontWeight: "500" },
  optionCardSubSelected: { color: `${colors.primary}99` },

  // Diet grid
  dietGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 4 },
  dietCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1.5,
    borderColor: "#e2e8f0",
    borderRadius: 99,
    paddingVertical: 7,
    paddingHorizontal: 12,
    backgroundColor: "#f8fafc"
  },
  dietCardSelected: { borderColor: colors.primary, backgroundColor: `${colors.primary}10` },
  dietCardText: { fontSize: 12, fontWeight: "600", color: "#64748b", textTransform: "capitalize" },
  dietCardTextSelected: { color: colors.primary },

  // Toggle
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: "#f8fafc",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    marginBottom: 4
  },
  toggleLeft: { flex: 1, marginRight: 12 },
  toggleLabel: { fontSize: 14, fontWeight: "600", color: "#0f172a" },
  toggleHint: { fontSize: 11, color: "#94a3b8", marginTop: 2 },
  toggleTrack: {
    width: 44,
    height: 26,
    borderRadius: 99,
    backgroundColor: "#e2e8f0",
    padding: 3
  },
  toggleTrackOn: { backgroundColor: colors.primary },
  toggleThumb: {
    width: 20,
    height: 20,
    borderRadius: 99,
    backgroundColor: "white"
  },
  toggleThumbOn: { transform: [{ translateX: 18 }] },

  // Action buttons
  actionBtnGroup: { gap: 8, marginTop: 10 },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 11,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    backgroundColor: "#f8fafc"
  },
  actionBtnText: { fontSize: 13, fontWeight: "600", color: "#475569" },

  // Weight row
  weightRow: { flexDirection: "row", alignItems: "flex-end", gap: 0 },
  weightArrow: { paddingBottom: 14, paddingHorizontal: 10 },

  // Quiet hours
  quietRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  quietField: { flex: 1 },
  quietFieldLabel: { fontSize: 11, color: "#94a3b8", fontWeight: "600", marginBottom: 5 },
  quietInput: {
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 15,
    color: "#0f172a",
    backgroundColor: "#f8fafc",
    textAlign: "center",
    fontWeight: "700"
  },

  // Save CTA
  saveCta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 16,
    borderRadius: 16,
    backgroundColor: colors.primary,
    marginBottom: 10
  },
  saveCtaDisabled: { opacity: 0.5 },
  saveCtaText: { color: "white", fontSize: 16, fontWeight: "800" },

  // Sign out
  signOutBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: "#fff1f2",
    borderWidth: 1,
    borderColor: "#fecdd3"
  },
  signOutText: { color: "#be123c", fontSize: 14, fontWeight: "700" }
});
