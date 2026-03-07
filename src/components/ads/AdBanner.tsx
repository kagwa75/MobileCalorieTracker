import { useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { getBannerUnitId, isAdRuntimeSupported } from "@/lib/ads";
import { useAds } from "@/providers/AdsProvider";
import { useMonetization } from "@/hooks/useMonetization";
import { captureClientError } from "@/lib/monitoring";
import { colors } from "@/theme/tokens";

export function AdBanner() {
  const { isAdFree, isLoading } = useMonetization();
  const { canRequestAds, isInitializing: adsInitializing, requestNonPersonalizedAdsOnly, statusMessage } = useAds();
  const adsSupported = isAdRuntimeSupported();
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasFailed, setHasFailed] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [bannerKey, setBannerKey] = useState(0);
  const reachedRetryCap = retryCount >= 3;

  const adModule = useMemo(() => {
    if (!adsSupported) return null;

    return require("react-native-google-mobile-ads") as typeof import("react-native-google-mobile-ads");
  }, [adsSupported]);

  useEffect(() => {
    if (!hasFailed || reachedRetryCap) return;

    const delayMs = Math.min(8_000 * 2 ** retryCount, 45_000);
    const retryTimer = setTimeout(() => {
      setHasFailed(false);
      setLoadError(null);
      setBannerKey((prev) => prev + 1);
      setRetryCount((prev) => prev + 1);
    }, delayMs);

    return () => clearTimeout(retryTimer);
  }, [hasFailed, reachedRetryCap, retryCount]);

  if (!adsSupported || !adModule || isLoading || isAdFree || adsInitializing || !canRequestAds) {
    if (!__DEV__) return null;

    const reason = !adsSupported
      ? "Ad runtime not supported (Expo Go)."
      : !adModule
        ? "Ad module unavailable."
        : isLoading
          ? "Checking monetization state..."
          : isAdFree
            ? "Ad-free mode is enabled."
            : adsInitializing
              ? "Initializing ad SDK..."
              : statusMessage || "Ads blocked by consent state.";

    return (
      <View style={{ marginTop: 10, padding: 10, borderRadius: 10, backgroundColor: "#eef5ff" }}>
        <Text style={{ color: colors.mutedText, fontSize: 12 }}>Ad debug: {reason}</Text>
      </View>
    );
  }

  if (hasFailed && reachedRetryCap && !__DEV__) {
    return null;
  }

  const unitId = getBannerUnitId(adModule.TestIds.BANNER);

  return (
    <View style={[styles.wrap, !isLoaded && styles.wrapCollapsed]}>
      <View style={!isLoaded ? styles.bannerHidden : undefined}>
        <adModule.BannerAd
          key={bannerKey}
          unitId={unitId}
          size={adModule.BannerAdSize.MEDIUM_RECTANGLE}
          requestOptions={{ requestNonPersonalizedAdsOnly }}
          onAdLoaded={() => {
            setLoadError(null);
            setHasFailed(false);
            setIsLoaded(true);
            setRetryCount(0);
            if (__DEV__) console.log("[AdBanner] loaded");
          }}
          onAdFailedToLoad={(error) => {
            const message = error?.message || "Unknown ad load error";
            setLoadError(message);
            setIsLoaded(false);
            setHasFailed(true);
            void captureClientError(error, {
              scope: "ads",
              action: "banner-load-failed",
              retryCount,
              unitId
            });
            console.warn("[AdBanner] failed to load:", message);
          }}
        />
      </View>
      {__DEV__ && loadError ? (
        <Text style={styles.debugText}>Ad debug: {loadError}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: 10,
    alignItems: "center"
  },
  wrapCollapsed: {
    marginTop: 0,
    height: 0,
    overflow: "hidden"
  },
  bannerHidden: {
    opacity: 0
  },
  debugText: {
    marginTop: 6,
    color: colors.mutedText,
    fontSize: 12
  }
});
