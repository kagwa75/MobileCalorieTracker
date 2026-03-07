import { Pressable, StyleSheet, Text, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { AppCard } from "@/components/ui/AppCard";
import { colors, radius } from "@/theme/tokens";

type LoadFailureCardProps = {
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: (() => void) | null;
};

export function LoadFailureCard({ title, message, actionLabel = "Retry", onAction = null }: LoadFailureCardProps) {
  return (
    <AppCard style={styles.card}>
      <View style={styles.iconWrap}>
        <MaterialCommunityIcons name="cloud-alert-outline" size={20} color="#b45309" />
      </View>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.message}>{message}</Text>
      {onAction ? (
        <Pressable onPress={onAction} style={styles.actionBtn}>
          <MaterialCommunityIcons name="refresh" size={15} color="white" />
          <Text style={styles.actionText}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </AppCard>
  );
}

const styles = StyleSheet.create({
  card: {
    alignItems: "center",
    paddingVertical: 20
  },
  iconWrap: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: "#fef3c7",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10
  },
  title: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "800",
    textAlign: "center"
  },
  message: {
    marginTop: 6,
    color: colors.mutedText,
    textAlign: "center",
    lineHeight: 20,
    maxWidth: 320
  },
  actionBtn: {
    marginTop: 14,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 6
  },
  actionText: {
    color: "white",
    fontWeight: "700"
  }
});
