const retiredSupabaseHosts = new Set(["dgqmrwjqjlatthqwqwwm.supabase.co"]);

function readEnv(name: string) {
  const value = process.env[name]?.trim();

  return value ? value : undefined;
}

export function getSupabaseUrl() {
  return readEnv("SUPABASE_URL") ?? readEnv("NEXT_PUBLIC_SUPABASE_URL");
}

export function getSupabasePublishableKey() {
  return (
    readEnv("SUPABASE_PUBLISHABLE_KEY") ??
    readEnv("SUPABASE_ANON_KEY") ??
    readEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY") ??
    readEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY")
  );
}

export function getSupabaseConfigSource() {
  return {
    url:
      readEnv("SUPABASE_URL") !== undefined
        ? "SUPABASE_URL"
        : readEnv("NEXT_PUBLIC_SUPABASE_URL") !== undefined
          ? "NEXT_PUBLIC_SUPABASE_URL"
          : "missing",
    key:
      readEnv("SUPABASE_PUBLISHABLE_KEY") !== undefined
        ? "SUPABASE_PUBLISHABLE_KEY"
        : readEnv("SUPABASE_ANON_KEY") !== undefined
          ? "SUPABASE_ANON_KEY"
          : readEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY") !== undefined
            ? "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"
            : readEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY") !== undefined
              ? "NEXT_PUBLIC_SUPABASE_ANON_KEY"
              : "missing",
  };
}

function getSupabaseUrlValidationError(supabaseUrl: string) {
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(supabaseUrl);
  } catch {
    return "Invalid Supabase configuration. SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL must be a valid https://*.supabase.co URL.";
  }

  if (parsedUrl.protocol !== "https:") {
    return "Invalid Supabase configuration. Supabase URL must use https.";
  }

  if (!parsedUrl.hostname.endsWith(".supabase.co")) {
    return "Invalid Supabase configuration. Supabase URL must point to a *.supabase.co host.";
  }

  if (retiredSupabaseHosts.has(parsedUrl.hostname)) {
    return "Invalid Supabase configuration. The configured Supabase project host is retired or unreachable. Update SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL in production.";
  }

  return "";
}

export function hasSupabaseConfig() {
  return Boolean(getSupabaseUrl() && getSupabasePublishableKey());
}

export function requireSupabaseConfig() {
  const supabaseUrl = getSupabaseUrl();
  const supabaseKey = getSupabasePublishableKey();

  if (!supabaseUrl || !supabaseKey) {
    throw new Error(
      "Missing Supabase configuration. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY to .env.local."
    );
  }

  const supabaseUrlValidationError = getSupabaseUrlValidationError(supabaseUrl);

  if (supabaseUrlValidationError) {
    throw new Error(supabaseUrlValidationError);
  }

  return {
    supabaseUrl: new URL(supabaseUrl).origin,
    supabaseKey,
  };
}
