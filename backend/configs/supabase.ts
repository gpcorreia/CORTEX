import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "./env.js";

let client: SupabaseClient | undefined;

export function getSupabase(): SupabaseClient {
  if (client) return client;
  if (!env.supabaseUrl || !env.supabaseKey)
    throw Object.assign(
      new Error("Configura SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no .env."),
      { status: 503 },
    );

  client = createClient(env.supabaseUrl, env.supabaseKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return client;
}
