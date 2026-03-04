import { ActivityIndicator, StyleSheet, View } from "react-native";
import { Redirect, Tabs } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useAuth } from "@/providers/AuthProvider";
import { colors, radius, shadow } from "@/theme/tokens";

export default function TabsLayout() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (!user) {
    return <Redirect href="/(auth)/sign-in" />;
  }

  return (
    <Tabs
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: "#7b8ba5",
        tabBarHideOnKeyboard: true,
        tabBarStyle: styles.tabBar,
        tabBarLabelStyle: styles.tabBarLabel,
        tabBarItemStyle: styles.tabBarItem,
        tabBarIcon: ({ focused, color, size }) => {
          const iconSize = size + (focused ? 2 : 0);
          let iconName: keyof typeof MaterialCommunityIcons.glyphMap = "view-dashboard";

          if (route.name === "dashboard") iconName = "view-dashboard-outline";
          if (route.name === "add-meal") iconName = "plus-circle-outline";
          if (route.name === "history") iconName = "chart-timeline-variant";
          if (route.name === "profile") iconName = "account-circle-outline";

          if (focused) {
            if (route.name === "dashboard") iconName = "view-dashboard";
            if (route.name === "add-meal") iconName = "plus-circle";
            if (route.name === "history") iconName = "chart-timeline-variant";
            if (route.name === "profile") iconName = "account-circle";
          }

          return <MaterialCommunityIcons name={iconName} size={iconSize} color={color} />;
        }
      })}
    >
      <Tabs.Screen name="dashboard" options={{ title: "Home" }} />
      <Tabs.Screen name="add-meal" options={{ title: "Add" }} />
      <Tabs.Screen name="history" options={{ title: "History" }} />
      <Tabs.Screen name="profile" options={{ title: "Profile" }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    position: "absolute",
    left: 14,
    right: 14,
    bottom: 12,
    borderRadius: radius.lg,
    height: 68,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingBottom: 6,
    paddingTop: 6,
    ...shadow
  },
  tabBarLabel: {
    fontSize: 12,
    fontWeight: "700"
  },
  tabBarItem: {
    borderRadius: radius.md
  }
});
