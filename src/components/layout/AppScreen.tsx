import type { ReactNode } from "react";
import { RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors } from "@/theme/tokens";

type AppScreenProps = {
  children: ReactNode;
  scroll?: boolean;
  refreshing?: boolean;
  onRefresh?: (() => void) | null;
};

export function AppScreen({ children, scroll = true, refreshing = false, onRefresh = null }: AppScreenProps) {
  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.decorTop} pointerEvents="none" />
      <View style={styles.decorBottom} pointerEvents="none" />

      {scroll ? (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            onRefresh
              ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
              : undefined
          }
        >
          {children}
        </ScrollView>
      ) : (
        <View style={styles.content}>{children}</View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background
  },
  content: {
    flex: 1,
    paddingHorizontal: 16,
    paddingBottom: 24
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 28
  },
  decorTop: {
    position: "absolute",
    top: -110,
    right: -90,
    width: 280,
    height: 280,
    borderRadius: 140,
    backgroundColor: colors.backgroundStrong
  },
  decorBottom: {
    position: "absolute",
    bottom: -120,
    left: -100,
    width: 260,
    height: 260,
    borderRadius: 130,
    backgroundColor: "#deebff"
  }
});
