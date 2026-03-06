import { useState } from "react";
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Link, Redirect, router } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { captureClientError } from "@/lib/monitoring";
import { validateAuthInput } from "@/lib/flowValidation";
import { useAuth } from "@/providers/AuthProvider";
import { AppScreen } from "@/components/layout/AppScreen";
import { AppButton } from "@/components/ui/AppButton";
import { AppCard } from "@/components/ui/AppCard";
import { colors, radius } from "@/theme/tokens";

export default function SignInScreen() {
  const { user, signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  if (user) {
    return <Redirect href="/" />;
  }

  const onSignIn = async () => {
    const normalizedEmail = email.trim();
    const validationError = validateAuthInput({ email: normalizedEmail, password, mode: "sign_in" });
    if (validationError) {
      Alert.alert("Invalid input", validationError);
      return;
    }

    setLoading(true);
    try {
      const { error } = await signIn(normalizedEmail, password);
      if (error) throw error;
      router.replace("/");
    } catch (error) {
      void captureClientError(error, { screen: "sign-in" });
      Alert.alert("Sign in failed", error instanceof Error ? error.message : "Please try again");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AppScreen scroll={false}>
      <View style={styles.wrap}>
        <View style={styles.brand}>
          <View style={styles.brandBadge}>
            <MaterialCommunityIcons name="fire" size={22} color="white" />
          </View>
          <Text style={styles.brandTitle}>Calorie Tracker</Text>
          <Text style={styles.brandSubtitle}>Log faster. Eat smarter.</Text>
        </View>

        <AppCard>
          <Text style={styles.title}>Welcome back</Text>
          <Text style={styles.subtitle}>Sign in to continue your nutrition streak.</Text>

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
            placeholder="••••••••"
            placeholderTextColor="#8ea0ba"
            secureTextEntry
            style={styles.input}
          />

          <Link href="/(auth)/forgot-password" asChild>
            <Pressable style={styles.inlineLinkWrap}>
              <Text style={styles.inlineLink}>Forgot password?</Text>
            </Pressable>
          </Link>

          <AppButton label={loading ? "Signing in..." : "Sign in"} onPress={onSignIn} disabled={loading} />

          <Link href="/(auth)/sign-up" asChild>
            <Pressable style={{ marginTop: 10 }}>
              <Text style={styles.switchAuthText}>
                No account yet? <Text style={styles.switchAuthLink}>Create one</Text>
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
  title: {
    fontSize: 22,
    fontWeight: "800",
    color: colors.text
  },
  subtitle: {
    color: colors.mutedText,
    marginTop: 2,
    marginBottom: 12
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
  inlineLinkWrap: {
    alignSelf: "flex-end",
    marginBottom: 12
  },
  inlineLink: {
    color: colors.primary,
    fontWeight: "700",
    fontSize: 13
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
