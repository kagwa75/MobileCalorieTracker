import { useState } from "react";
import { Alert, StyleSheet, Text, TextInput, View } from "react-native";
import { Link, router } from "expo-router";
import { captureClientError } from "@/lib/monitoring";
import { getSupabaseClient } from "@/lib/supabase";
import { useAuth } from "@/providers/AuthProvider";
import { AppScreen } from "@/components/layout/AppScreen";
import { AppButton } from "@/components/ui/AppButton";
import { AppCard } from "@/components/ui/AppCard";
import { colors, radius } from "@/theme/tokens";

export default function ResetPasswordScreen() {
  const { session, signOut, loading } = useAuth();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const onReset = async () => {
    if (password.length < 6) {
      Alert.alert("Weak password", "Password must be at least 6 characters.");
      return;
    }

    if (password !== confirmPassword) {
      Alert.alert("Mismatch", "Passwords do not match.");
      return;
    }

    setSubmitting(true);
    try {
      const supabase = getSupabaseClient();
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;

      await signOut();
      Alert.alert("Password updated", "Sign in with your new password.");
      router.replace("/(auth)/sign-in");
    } catch (error) {
      void captureClientError(error, { screen: "reset-password" });
      Alert.alert("Reset failed", error instanceof Error ? error.message : "Please try again");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AppScreen scroll={false}>
      <View style={styles.wrap}>
        <AppCard>
          <Text style={styles.title}>Create a new password</Text>
          <Text style={styles.subtitle}>
            Use the reset link from your email, then set a strong password below.
          </Text>

          {!loading && !session ? (
            <View style={styles.warningBox}>
              <Text style={styles.warningText}>
                No recovery session detected. Open the reset link from your email on this device.
              </Text>
            </View>
          ) : null}

          <Text style={styles.label}>New password</Text>
          <TextInput
            value={password}
            onChangeText={setPassword}
            placeholder="At least 6 characters"
            placeholderTextColor="#8ea0ba"
            secureTextEntry
            style={styles.input}
          />

          <Text style={styles.label}>Confirm password</Text>
          <TextInput
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            placeholder="Repeat password"
            placeholderTextColor="#8ea0ba"
            secureTextEntry
            style={styles.input}
          />

          <AppButton
            label={submitting ? "Updating..." : "Update password"}
            onPress={onReset}
            disabled={submitting || (!session && !loading)}
          />

          <Link href="/(auth)/sign-in" style={styles.backLink}>
            Back to sign in
          </Link>
        </AppCard>
      </View>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 16
  },
  title: {
    color: colors.text,
    fontSize: 23,
    fontWeight: "800"
  },
  subtitle: {
    color: colors.mutedText,
    marginTop: 3,
    marginBottom: 12
  },
  warningBox: {
    borderWidth: 1,
    borderColor: "#fbbf24",
    backgroundColor: "#fffbeb",
    borderRadius: radius.md,
    padding: 10,
    marginBottom: 10
  },
  warningText: {
    color: "#92400e",
    fontSize: 13,
    lineHeight: 18
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
    backgroundColor: "#f8fbff",
    marginBottom: 6
  },
  backLink: {
    textAlign: "center",
    color: colors.primary,
    fontWeight: "700",
    marginTop: 12
  }
});
