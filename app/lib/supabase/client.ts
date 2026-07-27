import { createBrowserClient, type CookieMethodsBrowser, type CookieOptions } from "@supabase/ssr";
import type { Session, SupabaseClient } from "@supabase/supabase-js";

let browserClient: SupabaseClient | null = null;

const CAPACITOR_COOKIE_REGISTRY_KEY = "zerinix.supabase.cookieNames";
const CAPACITOR_COOKIE_VALUE_PREFIX = "zerinix.supabase.cookie.";
const CAPACITOR_SESSION_STORAGE_KEY = "zerinix.supabase.authSession";

function isBrowserRuntime() {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

function readStoredCookieNames() {
  if (!isBrowserRuntime()) {
    return [];
  }

  try {
    const rawValue = window.localStorage.getItem(CAPACITOR_COOKIE_REGISTRY_KEY);
    const parsedValue: unknown = rawValue ? JSON.parse(rawValue) : [];

    return Array.isArray(parsedValue)
      ? parsedValue.filter((name): name is string => typeof name === "string")
      : [];
  } catch {
    return [];
  }
}

function writeStoredCookieNames(names: readonly string[]) {
  if (!isBrowserRuntime()) {
    return;
  }

  try {
    window.localStorage.setItem(
      CAPACITOR_COOKIE_REGISTRY_KEY,
      JSON.stringify([...new Set(names)])
    );
  } catch {
    // If localStorage is unavailable, document.cookie remains the browser fallback.
  }
}

function readStoredCookie(name: string) {
  if (!isBrowserRuntime()) {
    return null;
  }

  try {
    return window.localStorage.getItem(`${CAPACITOR_COOKIE_VALUE_PREFIX}${name}`);
  } catch {
    return null;
  }
}

function writeStoredCookie(name: string, value: string) {
  if (!isBrowserRuntime()) {
    return;
  }

  try {
    window.localStorage.setItem(`${CAPACITOR_COOKIE_VALUE_PREFIX}${name}`, value);
  } catch {
    // If localStorage is unavailable, document.cookie remains the browser fallback.
  }
}

function removeStoredCookie(name: string) {
  if (!isBrowserRuntime()) {
    return;
  }

  try {
    window.localStorage.removeItem(`${CAPACITOR_COOKIE_VALUE_PREFIX}${name}`);
  } catch {
    // No-op: cookie cleanup below still runs for normal browsers.
  }
}

function isUsableSession(value: unknown): value is Session {
  if (!value || typeof value !== "object") {
    return false;
  }

  const session = value as Partial<Session>;

  return (
    typeof session.access_token === "string" &&
    session.access_token.length > 0 &&
    typeof session.refresh_token === "string" &&
    session.refresh_token.length > 0
  );
}

function readStoredSession() {
  if (!isBrowserRuntime()) {
    return null;
  }

  try {
    const rawValue = window.localStorage.getItem(CAPACITOR_SESSION_STORAGE_KEY);
    const parsedValue: unknown = rawValue ? JSON.parse(rawValue) : null;

    return isUsableSession(parsedValue) ? parsedValue : null;
  } catch {
    return null;
  }
}

export function persistSupabaseSession(session: Session | null | undefined) {
  if (!isBrowserRuntime()) {
    return;
  }

  try {
    if (session) {
      window.localStorage.setItem(
        CAPACITOR_SESSION_STORAGE_KEY,
        JSON.stringify(session)
      );
    } else {
      window.localStorage.removeItem(CAPACITOR_SESSION_STORAGE_KEY);
    }
  } catch {
    // Auth cookies remain the primary browser fallback.
  }
}

export async function restoreSupabaseSession(client = createClient()) {
  const {
    data: { session },
  } = await client.auth.getSession();

  if (session?.access_token) {
    persistSupabaseSession(session);
    return session;
  }

  const storedSession = readStoredSession();

  if (!storedSession) {
    return null;
  }

  const { data, error } = await client.auth.setSession({
    access_token: storedSession.access_token,
    refresh_token: storedSession.refresh_token,
  });

  if (error || !data.session?.access_token) {
    persistSupabaseSession(null);
    return null;
  }

  persistSupabaseSession(data.session);
  return data.session;
}

function readDocumentCookies() {
  if (!isBrowserRuntime()) {
    return [];
  }

  return document.cookie
    .split(";")
    .map((cookie) => cookie.trim())
    .filter(Boolean)
    .map((cookie) => {
      const separatorIndex = cookie.indexOf("=");
      const name =
        separatorIndex === -1 ? cookie : cookie.slice(0, separatorIndex);
      const value =
        separatorIndex === -1 ? "" : cookie.slice(separatorIndex + 1);

      return { name, value };
    });
}

function writeDocumentCookie(name: string, value: string, options: CookieOptions) {
  if (!isBrowserRuntime()) {
    return;
  }

  const segments = [`${name}=${value}`];
  const path = typeof options.path === "string" ? options.path : "/";

  segments.push(`Path=${path}`);

  if (typeof options.maxAge === "number") {
    segments.push(`Max-Age=${options.maxAge}`);
  }

  if (options.sameSite) {
    segments.push(`SameSite=${String(options.sameSite)}`);
  }

  if (options.secure) {
    segments.push("Secure");
  }

  document.cookie = segments.join("; ");
}

const capacitorSafeCookies: CookieMethodsBrowser = {
  getAll() {
    const cookiesByName = new Map<string, string>();

    for (const cookie of readDocumentCookies()) {
      cookiesByName.set(cookie.name, cookie.value);
    }

    for (const name of readStoredCookieNames()) {
      const value = readStoredCookie(name);

      if (typeof value === "string") {
        cookiesByName.set(name, value);
      }
    }

    return Array.from(cookiesByName, ([name, value]) => ({ name, value }));
  },
  setAll(cookiesToSet) {
    const storedCookieNames = new Set(readStoredCookieNames());

    cookiesToSet.forEach(({ name, value, options }) => {
      writeDocumentCookie(name, value, options);

      if (!value || options.maxAge === 0) {
        removeStoredCookie(name);
        storedCookieNames.delete(name);
        return;
      }

      writeStoredCookie(name, value);
      storedCookieNames.add(name);
    });

    writeStoredCookieNames([...storedCookieNames]);
  },
};

export function createClient() {
  if (browserClient) {
    return browserClient;
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const supabaseKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

  if (supabaseKey?.startsWith("sb_secret_")) {
    console.error("[supabase:browser_client] Refusing secret Supabase key in browser config", {
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env
        .NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
        ? "loaded"
        : "missing",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
        ? "loaded"
        : "missing",
    });

    throw new Error(
      "Invalid Supabase browser configuration. Use NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY with a publishable key, not a secret key."
    );
  }

  if (!supabaseUrl || !supabaseKey) {
    console.error("[supabase:browser_client] Missing public Supabase config", {
      NEXT_PUBLIC_SUPABASE_URL: supabaseUrl ? "loaded" : "missing",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env
        .NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
        ? "loaded"
        : "missing",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
        ? "loaded"
        : "missing",
    });

    throw new Error(
      "Missing Supabase configuration. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY to the production environment."
    );
  }

  browserClient = createBrowserClient(supabaseUrl, supabaseKey, {
    cookies: capacitorSafeCookies,
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });

  browserClient.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_OUT") {
      persistSupabaseSession(null);
      return;
    }

    if (session) {
      persistSupabaseSession(session);
    }
  });

  return browserClient;
}
