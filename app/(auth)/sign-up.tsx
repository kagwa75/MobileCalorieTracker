import { useState } from "react";
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Link, Redirect, router } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { captureClientError } from "@/lib/monitoring";
import { useAuth } from "@/providers/AuthProvider";
import { AppScreen } from "@/components/layout/AppScreen";
import { AppButton } from "@/components/ui/AppButton";
import { AppCard } from "@/components/ui/AppCard";
import { colors, radius } from "@/theme/tokens";

export default function SignUpScreen() {
  const { user, signUp } = useAuth();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  if (user) {
    return <Redirect href="/(tabs)/dashboard" />;
  }

  const onSignUp = async () => {
    const normalizedEmail = email.trim();

    if (!normalizedEmail || !password) {
      Alert.alert("Missing fields", "Enter email and password.");
      return;
    }

    if (password.length < 6) {
      Alert.alert("Weak password", "Password must be at least 6 characters.");
      return;
    }

    setLoading(true);
    try {
      const { error } = await signUp(normalizedEmail, password, displayName.trim() || undefined);
      if (error) throw error;

      Alert.alert("Account created", "Check your email if confirmation is enabled.");
      router.replace("/(auth)/sign-in");
    } catch (error) {
      void captureClientError(error, { screen: "sign-up" });
      Alert.alert("Sign up failed", error instanceof Error ? error.message : "Please try again");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AppScreen scroll={false}>
      <View style={styles.wrap}>
        <View style={styles.brand}>
          <View style={styles.brandBadge}>
            <MaterialCommunityIcons name="food-apple" size={20} color="white" />
          </View>
          <Text style={styles.brandTitle}>Create account</Text>
          <Text style={styles.brandSubtitle}>Start tracking your meals in minutes.</Text>
        </View>

        <AppCard>
          <Text style={styles.label}>Display name</Text>
          <TextInput
            value={displayName}
            onChangeText={setDisplayName}
            placeholder="Your name"
            placeholderTextColor="#8ea0ba"
            autoCapitalize="words"
            style={styles.input}
          />

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

          <Text style={styles.label}>Password</Text>
          <TextInput
            value={password}
            onChangeText={setPassword}
            placeholder="At least 6 characters"
            placeholderTextColor="#8ea0ba"
            secureTextEntry
            style={styles.input}
          />

          <AppButton
            label={loading ? "Creating account..." : "Create account"}
            onPress={onSignUp}
            disabled={loading}
            style={{ marginTop: 8 }}
          />

          <Link href="/(auth)/sign-in" asChild>
            <Pressable style={{ marginTop: 10 }}>
              <Text style={styles.switchAuthText}>
                Already have an account? <Text style={styles.switchAuthLink}>Sign in</Text>
              </Text>
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
    paddingHorizontal: 16,
    gap: 14
  },
  brand: {
    alignItems: "center",
    marginBottom: 2
  },
  brandBadge: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8
  },
  brandTitle: {
    color: colors.text,
    fontSize: 24,
    fontWeight: "800"
  },
  brandSubtitle: {
    color: colors.mutedText,
    marginTop: 2
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
    marginBottom: 4
  },
  switchAuthText: {
    textAlign: "center",
    color: colors.mutedText,
    fontSize: 14
  },
  switchAuthLink: {
    color: colors.primary,
    fontWeight: "700"
  }
});
