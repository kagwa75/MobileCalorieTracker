import { createContext, useContext, useEffect, useMemo, useState } from "react";
import * as Linking from "expo-linking";
import type { Session, User } from "@supabase/supabase-js";
import { getSupabaseClient, isSupabaseConfigured } from "@/lib/supabase";

type AuthContextValue = {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signUp: (email: string, password: string, displayName?: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue>({
  user: null,
  session: null,
  loading: true,
  signIn: async () => ({ error: new Error("Auth not initialized") }),
  signUp: async () => ({ error: new Error("Auth not initialized") }),
  signOut: async () => {}
});

function parseAuthTokensFromUrl(url: string) {
  const [beforeHash, hashPart] = url.split("#");
  const queryPart = beforeHash.includes("?") ? beforeHash.split("?")[1] : "";
  const params = new URLSearchParams([queryPart, hashPart || ""].filter(Boolean).join("&"));

  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");
  const type = params.get("type");

  return {
    accessToken,
    refreshToken,
    type
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setSession(null);
      setLoading(false);
      return;
    }

    const supabase = getSupabaseClient();

    const syncSessionFromUrl = async (url: string) => {
      const { accessToken, refreshToken } = parseAuthTokensFromUrl(url);
      if (!accessToken || !refreshToken) return;

      try {
        await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken
        });
      } catch {
        // Keep auth listener as source of truth.
      }
    };

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session ?? null);
      setLoading(false);
    });

    void Linking.getInitialURL().then((initialUrl) => {
      if (!initialUrl) return;
      void syncSessionFromUrl(initialUrl);
    });

    const linkSub = Linking.addEventListener("url", ({ url }) => {
      void syncSessionFromUrl(url);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession ?? null);
      setLoading(false);
    });

    return () => {
      listener.subscription.unsubscribe();
      linkSub.remove();
    };
  }, []);

  const signIn = async (email: string, password: string) => {
    try {
      const supabase = getSupabaseClient();
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      return { error: (error as Error | null) ?? null };
    } catch (error) {
      return { error: error as Error };
    }
  };

  const signUp = async (email: string, password: string, displayName?: string) => {
    try {
      const supabase = getSupabaseClient();
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: displayName ? { display_name: displayName } : undefined
        }
      });
      return { error: (error as Error | null) ?? null };
    } catch (error) {
      return { error: error as Error };
    }
  };

  const signOut = async () => {
    if (!isSupabaseConfigured) return;
    const supabase = getSupabaseClient();
    await supabase.auth.signOut();
  };

  const value = useMemo<AuthContextValue>(
    () => ({ user: session?.user ?? null, session, loading, signIn, signUp, signOut }),
    [session, loading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
