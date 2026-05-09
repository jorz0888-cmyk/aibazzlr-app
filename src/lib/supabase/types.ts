/**
 * Supabase Database types — hand-written until `supabase gen types` is wired in.
 *
 * Reflects supabase/migrations/* . Keep in sync manually for now.
 */

// ---- Domain enums --------------------------------------------------------
export type Platform = "x" | "threads" | "instagram";

export type SocialAccountStatus =
  | "active"
  | "expired"
  | "disconnected"
  | "error";

export type PostStatus =
  | "draft"
  | "scheduled"
  | "publishing"
  | "published"
  | "failed"
  | "cancelled";

export type Plan = "free" | "starter" | "pro";

/** Account mode — separates real businesses from fictional/persona brands. */
export type AccountMode = "real" | "fictional";

export const DEFAULT_ACCOUNT_MODE: AccountMode = "real";

/** Normalize an arbitrary value to a valid AccountMode. */
export function normalizeAccountMode(v: unknown): AccountMode {
  return v === "fictional" ? "fictional" : "real";
}

// ---- Row shapes ----------------------------------------------------------
export type Profile = {
  id: string;
  email: string;
  name: string | null;
  plan: Plan;
  created_at: string;
  updated_at: string;
};

export type SocialAccount = {
  id: string;
  user_id: string;
  platform: Platform;
  username: string;
  display_name: string | null;
  // Encrypted token storage (AES-256-GCM ciphertext+iv+tag, base64)
  access_token: string | null;
  access_token_iv: string | null;
  access_token_tag: string | null;
  refresh_token: string | null;
  refresh_token_iv: string | null;
  refresh_token_tag: string | null;
  token_expires_at: string | null;
  scopes: string[] | null;
  token_type: string | null;
  platform_user_id: string | null;
  profile_image_url: string | null;
  status: SocialAccountStatus;
  is_primary: boolean;
  connected_at: string;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
};

// ---- OAuth sessions (Phase 6 — PKCE intermediate state) ------------------
export type OauthSession = {
  id: string;
  user_id: string;
  platform: Platform;
  state: string;
  code_verifier: string;
  redirect_after: string | null;
  expires_at: string;
  created_at: string;
};

/** Free-form text values stored in ai_configs.status / posting_frequency. */
export type AiConfigStatus = string; // e.g. "draft" | "active" | "paused"
export type PostingFrequency = string; // e.g. "daily" | "weekly" | "custom"

/** Shape of ai_configs.posting_times (jsonb). Keep loose; concrete schema TBD. */
export type PostingTimes = Record<string, unknown> | null;

export type AiConfig = {
  id: string;
  user_id: string;
  name: string;
  is_default: boolean;
  status: AiConfigStatus | null;
  industry: string | null;
  business_name: string | null;
  business_description: string | null;
  persona_role: string | null;
  world_view: string | null;
  voice_tone: string | null;
  target_audience: string | null;
  ng_words: string[];
  must_include_elements: string[];
  good_examples: string[];
  bad_examples: string[];
  hashtag_pool: string[];
  hashtags_per_post: number;
  posting_frequency: PostingFrequency | null;
  posting_times: PostingTimes;
  social_account_ids: string[];
  generated_system_prompt: string | null;
  requires_approval: boolean;
  // -- Phase 5.8: account mode + real-mode fields --
  account_mode: AccountMode;
  business_hours: string | null;
  closed_days: string | null;
  address: string | null;
  price_range: string | null;
  menu_items: string[];
  seasonal_items: string[];
  real_episodes: string[];
  announcement_topics: string[];
  // ----------------------------------------------
  created_at: string;
  updated_at: string;
};

export type Post = {
  id: string;
  user_id: string;
  ai_config_id: string | null;
  social_account_id: string | null;
  status: PostStatus;
  scheduled_at: string | null;
  published_at: string | null;
  content: string;
  image_url: string | null;
  external_post_id: string | null;
  engagement_count: number;
  error_message: string | null;
  created_at: string;
  updated_at: string;
};

export type PromptTemplate = {
  id: string;
  industry: string;
  name: string;
  description: string | null;
  default_world_view: string | null;
  default_voice_tone: string | null;
  default_persona_role: string | null;
  default_must_include_elements: string[];
  default_good_examples: string[];
  default_hashtag_pool: string[];
  default_ng_words: string[];
  is_published: boolean;
  display_order: number;
  created_at: string;
  updated_at: string;
};

// ---- AI Hearing Sessions ------------------------------------------------
export type HearingSessionStatus = "in_progress" | "completed" | "abandoned";

export type HearingMessage = {
  role: "user" | "assistant";
  content: string;
  created_at: string;
};

export type ExtractedHearingData = {
  complete?: boolean;
  account_mode?: AccountMode;
  /** Display name for the AI config; falls back to business_name. */
  name?: string;
  industry?: string;
  business_name?: string;
  business_description?: string;
  persona_role?: string;
  world_view?: string;
  voice_tone?: string;
  target_audience?: string;
  must_include_elements?: string[];
  good_examples?: string[];
  ng_words?: string[];
  hashtag_pool?: string[];
  summary_message?: string;
  // -- Real-mode fields (only populated when account_mode === 'real') --
  business_hours?: string;
  closed_days?: string;
  address?: string;
  price_range?: string;
  menu_items?: string[];
  seasonal_items?: string[];
  real_episodes?: string[];
  announcement_topics?: string[];
};

export type AiHearingSession = {
  id: string;
  user_id: string;
  status: HearingSessionStatus;
  industry: string | null;
  account_mode: AccountMode;
  messages: HearingMessage[];
  extracted_data: ExtractedHearingData | null;
  generated_system_prompt: string | null;
  current_step: number;
  ai_config_id: string | null;
  started_at: string;
  generated_at: string | null;
  created_at: string;
  updated_at: string;
};

// ---- Insert / Update payloads -------------------------------------------
// Insert payloads are intentionally permissive: every field is optional so
// that DB defaults (timestamps, status, current_step, etc.) can fill in
// what callers omit. Required fields (e.g. user_id, content) are enforced
// at runtime by the DB's NOT NULL constraints, which surface as proper
// errors via the API rather than blocking compile-time when we want to
// insert with minimal payloads.
type Insertable<T extends { id: string; created_at: string; updated_at: string }> = Partial<
  Omit<T, "created_at" | "updated_at">
>;

type Updatable<T> = Partial<
  Omit<T, "id" | "user_id" | "created_at" | "updated_at">
>;

export type SocialAccountInsert = Insertable<SocialAccount>;
export type SocialAccountUpdate = Updatable<SocialAccount>;

export type AiConfigInsert = Insertable<AiConfig>;
export type AiConfigUpdate = Updatable<AiConfig>;

export type PostInsert = Insertable<Post>;
export type PostUpdate = Updatable<Post>;

export type PromptTemplateInsert = Insertable<PromptTemplate>;
export type PromptTemplateUpdate = Updatable<PromptTemplate>;

export type AiHearingSessionInsert = Insertable<AiHearingSession>;
export type AiHearingSessionUpdate = Updatable<AiHearingSession>;

export type OauthSessionInsert = Partial<
  Omit<OauthSession, "created_at" | "expires_at">
> & {
  expires_at?: string;
};
export type OauthSessionUpdate = Partial<
  Omit<OauthSession, "id" | "user_id" | "created_at">
>;

// ---- Database (for typed Supabase client) -------------------------------
export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: Profile;
        Insert: Insertable<Profile>;
        Update: Updatable<Profile>;
        Relationships: [];
      };
      social_accounts: {
        Row: SocialAccount;
        Insert: SocialAccountInsert;
        Update: SocialAccountUpdate;
        Relationships: [];
      };
      ai_configs: {
        Row: AiConfig;
        Insert: AiConfigInsert;
        Update: AiConfigUpdate;
        Relationships: [];
      };
      posts: {
        Row: Post;
        Insert: PostInsert;
        Update: PostUpdate;
        Relationships: [];
      };
      prompt_templates: {
        Row: PromptTemplate;
        Insert: PromptTemplateInsert;
        Update: PromptTemplateUpdate;
        Relationships: [];
      };
      ai_hearing_sessions: {
        Row: AiHearingSession;
        Insert: AiHearingSessionInsert;
        Update: AiHearingSessionUpdate;
        Relationships: [];
      };
      oauth_sessions: {
        Row: OauthSession;
        Insert: OauthSessionInsert;
        Update: OauthSessionUpdate;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
