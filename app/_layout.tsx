import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { AuthProvider } from "@/providers/AuthProvider";
import { QueryProvider } from "@/providers/QueryProvider";
import { supabaseConfigError } from "@/lib/supabase";
import { colors, radius } from "@/theme/tokens";

export default function RootLayout() {
  if (supabaseConfigError) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.configCard}>
          <View style={styles.iconWrap}>
            <MaterialCommunityIcons name="cog-outline" size={26} color="white" />
          </View>

          <Text style={styles.title}>Configuration required</Text>
          <Text style={styles.subtitle}>{supabaseConfigError}</Text>

          <Text style={styles.hint}>Set these in `apps/calorieTrackerMobile/.env`, then restart Expo:</Text>
          <Text style={styles.codeLine}>EXPO_PUBLIC_SUPABASE_URL</Text>
          <Text style={styles.codeLine}>EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY</Text>
          <Text style={styles.command}>npx expo start -c</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <QueryProvider>
      <AuthProvider>
        <StatusBar style="dark" />
        <Stack screenOptions={{ headerShown: false }} />
      </AuthProvider>
    </QueryProvider>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
    padding: 20,
    justifyContent: "center"
  },
  configCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: 18
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10
  },
  title: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "800"
  },
  subtitle: {
    color: colors.mutedText,
    marginTop: 4,
    marginBottom: 10
  },
  hint: {
    color: colors.mutedText,
    marginBottom: 8
  },
  codeLine: {
    color: colors.primary,
    fontWeight: "700"
  },
  command: {
    marginTop: 10,
    color: colors.text,
    fontWeight: "700"
  }
});
