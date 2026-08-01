import "server-only";

import { createClient as createSupabaseClient, type User } from "@supabase/supabase-js";
import { createClient } from "@/app/lib/supabase/server";
import {
  getSupabasePublishableKey,
  getSupabaseUrl,
} from "@/app/lib/supabase/env";

function readBearerToken(request: Request) {
  const authorization = request.headers.get("authorization") || "";
  return authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || "";
}

export async function createAuthenticatedReportJobClient(request: Request) {
  const cookieClient = await createClient();
  const accessToken = readBearerToken(request);
  const {
    data: { user: cookieUser },
    error: cookieUserError,
  } = await cookieClient.auth.getUser();

  if (cookieUser && !cookieUserError) {
    return { supabase: cookieClient, user: cookieUser };
  }

  if (!accessToken) {
    return { supabase: cookieClient, user: null as User | null };
  }

  const supabaseUrl = getSupabaseUrl();
  const supabaseKey = getSupabasePublishableKey();

  if (!supabaseUrl || !supabaseKey) {
    return { supabase: cookieClient, user: null as User | null };
  }

  const bearerClient = createSupabaseClient(supabaseUrl, supabaseKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  });
  const {
    data: { user: bearerUser },
    error: bearerUserError,
  } = await bearerClient.auth.getUser(accessToken);

  return {
    supabase: bearerUser && !bearerUserError ? bearerClient : cookieClient,
    user: bearerUser && !bearerUserError ? bearerUser : null,
  };
}
