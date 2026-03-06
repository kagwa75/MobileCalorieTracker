// components/AdBanner.jsx
import { BannerAd, BannerAdSize } from 'react-native-google-mobile-ads';
import { useMonetization } from '../hooks/useMonetization';

export function AdBanner() {
  const { isAdFree, BANNER_ID } = useMonetization();

  if (isAdFree) return null; // 👈 Instantly hides for paying users

  return (
    <BannerAd
      unitId={BANNER_ID}
      size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
      requestOptions={{ requestNonPersonalizedAdsOnly: true }}
    />
  );
}