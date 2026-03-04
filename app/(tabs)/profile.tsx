import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, StyleSheet, Text, TextInput, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { captureClientError } from "@/lib/monitoring";
import { useAuth } from "@/providers/AuthProvider";
import { useProfile, useUpdateProfile } from "@/hooks/useProfile";
import { AppScreen } from "@/components/layout/AppScreen";
import { AppButton } from "@/components/ui/AppButton";
import { AppCard } from "@/components/ui/AppCard";
import { colors, radius } from "@/theme/tokens";

export default function ProfileScreen() {
  const { user, signOut } = useAuth();
  const { data: profile, isLoading } = useProfile();
  const updateProfile = useUpdateProfile();

  const [displayName, setDisplayName] = useState("");
  const [calorieGoal, setCalorieGoal] = useState("2000");

  useEffect(() => {
    if (!profile) return;
    setDisplayName(profile.display_name || "");
    setCalorieGoal(String(profile.daily_calorie_goal || 2000));
  }, [profile]);

  const onSave = async () => {
    const goalValue = Number.parseInt(calorieGoal, 10);

    if (!Number.isFinite(goalValue) || goalValue < 500 || goalValue > 10000) {
      Alert.alert("Invalid goal", "Set a daily calorie goal between 500 and 10000.");
      return;
    }

    try {
      await updateProfile.mutateAsync({
        display_name: displayName.trim(),
        daily_calorie_goal: goalValue
      });
      Alert.alert("Saved", "Profile updated successfully.");
    } catch (error) {
      void captureClientError(error, { screen: "profile", action: "update-profile" });
      Alert.alert("Save failed", error instanceof Error ? error.message : "Could not update profile");
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
  }
});
