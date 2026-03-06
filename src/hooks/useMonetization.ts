import { useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

const AD_FREE_STORAGE_KEY = "@calorie-tracker/ad-free-local";

export function useMonetization() {
  const [isLoading, setIsLoading] = useState(true);
  const [isAdFree, setIsAdFree] = useState(false);

  useEffect(() => {
    let mounted = true;

    AsyncStorage.getItem(AD_FREE_STORAGE_KEY)
      .then((value) => {
        if (!mounted) return;
        setIsAdFree(value === "true");
      })
      .finally(() => {
        if (mounted) setIsLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, []);

  const setAdFreeLocal = async (nextValue: boolean) => {
    setIsAdFree(nextValue);
    await AsyncStorage.setItem(AD_FREE_STORAGE_KEY, nextValue ? "true" : "false");
  };

  return {
    isLoading,
    isAdFree,
    setAdFreeLocal
  };
}
