import { TouchableOpacity, Text, StyleSheet } from 'react-native';
import { useMonetization } from '../hooks/useMonetization';

export function RemoveAdsButton() {
  const { isAdFree, isPurchasing, buyAdFree } = useMonetization();

  if (isAdFree) return null; // Already paid, don't show the button

  return (
    <TouchableOpacity style={styles.button} onPress={buyAdFree} disabled={isPurchasing}>
      <Text style={styles.text}>
        {isPurchasing ? 'Processing...' : '✨ Remove Ads — $1.99'}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: { backgroundColor: '#6C63FF', padding: 12, borderRadius: 8, alignItems: 'center' },
  text:   { color: '#fff', fontWeight: 'bold', fontSize: 15 },
});