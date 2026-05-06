/**
 * Generated Supabase database types.
 * For now we declare a minimal Profiles row by hand.
 * Replace with `npx supabase gen types typescript` once the schema stabilises.
 */
export type Profile = {
  id: string;
  email: string;
  name: string | null;
  plan: "free" | "starter" | "pro";
  created_at: string;
  updated_at: string;
};
