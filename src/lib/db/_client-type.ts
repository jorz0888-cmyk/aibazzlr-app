import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/lib/supabase/types";

/**
 * Shared "typed Supabase client" alias.
 *
 * We derive the type from `createBrowserClient<Database>` rather than declaring
 * `SupabaseClient<Database>` directly, because @supabase/supabase-js 2.105+
 * introduced extra generic parameters (`SchemaNameOrClientOptions`,
 * `ClientOptions`) whose default-resolution behaves differently for
 * structurally-equal types. Using the inferred return type sidesteps the
 * mismatch.
 *
 * The browser and server clients share the same shape from the perspective of
 * .from(...) / .auth, so this alias works in both contexts.
 */
export type DBClient = ReturnType<typeof createBrowserClient<Database>>;
