import { useState } from "react";
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import * as Linking from "expo-linking";
import { Link } from "expo-router";
import { captureClientError } from "@/lib/monitoring";
import { getSupabaseClient } from "@/lib/supabase";
import { AppScreen } from "@/components/layout/AppScreen";
import { AppButton } from "@/components/ui/AppButton";
import { AppCard } from "@/components/ui/AppCard";
import { colors, radius } from "@/theme/tokens";

export default function ForgotPasswordScreen() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const onSend = async () => {
    const normalizedEmail = email.trim();
    if (!normalizedEmail) {
      Alert.alert("Missing email", "Enter your account email.");
      return;
    }

    setSubmitting(true);

    try {
      const supabase = getSupabaseClient();
      const redirectTo = Linking.createURL("/reset-password");

      const { error } = await supabase.auth.resetPasswordForEmail(normalizedEmail, {
        redirectTo
      });

      if (error) throw error;

      Alert.alert("Reset email sent", "Open the email on this phone and follow the link.");
    } catch (error) {
      void captureClientError(error, { screen: "forgot-password" });
      Alert.alert("Request failed", error instanceof Error ? error.message : "Please try again");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AppScreen scroll={false}>
      <View style={styles.wrap}>
        <AppCard>
          <Text style={styles.title}>Reset your password</Text>
          <Text style={styles.subtitle}>Enter your email and we’ll send a secure reset link.</Text>

          <Text style={styles.label}>Email</Text>
          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            placeholderTextColor="#8ea0ba"
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.input}
          />

          <AppButton label={submitting ? "Sending..." : "Send reset email"} onPress={onSend} disabled={submitting} />

          <Link href="/(auth)/sign-in" asChild>
            <Pressable style={{ marginTop: 10 }}>
              <Text style={styles.backLink}>Back to sign in</Text>
            </Pressable>
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
    marginBottom: 14
  },
  label: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "600",
    marginBottom: 5
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
    marginBottom: 12
  },
  backLink: {
    textAlign: "center",
    color: colors.primary,
    fontWeight: "700"
  }
});
