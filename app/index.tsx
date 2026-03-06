import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { Redirect } from "expo-router";
import { useAuth } from "@/providers/AuthProvider";
import { isOnboardingComplete, useProfile } from "@/hooks/useProfile";
import { AppScreen } from "@/components/layout/AppScreen";
import { colors } from "@/theme/tokens";

export default function Index() {
  const { user, loading } = useAuth();
  const { data: profile, isLoading: profileLoading } = useProfile();

  if (loading || (user && profileLoading)) {
    return (
      <AppScreen scroll={false}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Preparing your dashboard...</Text>
        </View>
      </AppScreen>
    );
  }

  if (!user) return <Redirect href="/(auth)/sign-in" />;
  if (!isOnboardingComplete(profile)) return <Redirect href={"/onboarding" as never} />;
  return <Redirect href="/(tabs)/dashboard" />;
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center"
  },
  loadingText: {
    marginTop: 10,
    color: colors.mutedText,
    fontWeight: "600"
  }
});
