import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";

// Read only the integration settings; do not activate unrelated legacy .env settings.
function setting(name: string): string {
  if (process.env[name] !== undefined) return process.env[name]!.trim();
  try {
    return (
      parseEnv(readFileSync(new URL("../../.env", import.meta.url), "utf8"))[
        name
      ] ?? ""
    ).trim();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
}
export const env = {
  get supabaseUrl() {
    return setting("SUPABASE_URL");
  },
  get supabaseKey() {
    return setting("SUPABASE_SERVICE_ROLE_KEY") || setting("SUPABASE_KEY");
  },
  get shopifyDomain() {
    return setting("SHOPIFY_SHOP_DOMAIN");
  },
  get shopifyToken() {
    return setting("SHOPIFY_ADMIN_ACCESS_TOKEN");
  },
  get shopifyVersion() {
    return setting("SHOPIFY_API_VERSION") || "2026-10";
  },
  get jwtSecret() {
    return setting("JWT_SECRET");
  },
  get jwtIssuer() {
    return setting("JWT_ISSUER") || "cortex";
  },
  get jwtAudience() {
    return setting("JWT_AUDIENCE") || "cortex-web";
  },
  get adminEmail() {
    return setting("ADMIN_EMAIL").toLowerCase();
  },
  get appOrigin() {
    return setting("APP_ORIGIN").replace(/\/$/, "");
  },
  get adminCookieName() {
    return setting("ADMIN_COOKIE_NAME") || "cortex_session";
  },
  get adminSessionMaxAgeMs() {
    const value = Number(setting("ADMIN_SESSION_MAX_AGE_MS") || 604800000);
    return Number.isFinite(value) && value > 0 ? value : 604800000;
  },
  get adminSessionExpiresIn() {
    return setting("ADMIN_SESSION_EXPIRES_IN") || "7d";
  },
  get isProduction() {
    return setting("NODE_ENV") === "production";
  },
};
