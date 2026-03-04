import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from "react-native";
import { colors, radius } from "@/theme/tokens";

type AppButtonProps = {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  variant?: "primary" | "outline" | "danger";
  style?: StyleProp<ViewStyle>;
  leftIcon?: ReactNode;
};

export function AppButton({
  label,
  onPress,
  disabled = false,
  variant = "primary",
  style,
  leftIcon
}: AppButtonProps) {
  const isPrimary = variant === "primary";
  const isDanger = variant === "danger";

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.base,
        isPrimary && styles.primary,
        variant === "outline" && styles.outline,
        isDanger && styles.danger,
        disabled && styles.disabled,
        style
      ]}
    >
      {leftIcon}
      <Text
        style={[
          styles.text,
          isPrimary && styles.primaryText,
          variant === "outline" && styles.outlineText,
          isDanger && styles.dangerText
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.md,
    paddingVertical: 13,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8
  },
  primary: {
    backgroundColor: colors.primary
  },
  outline: {
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.surface
  },
  danger: {
    borderWidth: 1,
    borderColor: colors.danger,
    backgroundColor: colors.dangerSoft
  },
  disabled: {
    opacity: 0.55
  },
  text: {
    fontSize: 15,
    fontWeight: "700"
  },
  primaryText: {
    color: "#fff"
  },
  outlineText: {
    color: colors.primary
  },
  dangerText: {
    color: colors.danger
  }
});
