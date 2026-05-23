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
  | "error"
  | "token_invalid";

export type PostStatus =
  | "pending"
  | "draft"
  | "pending_approval"
  | "approved"
  | "rejected"
  | "awaiting_manual_post"
  | "posted_manually"
  | "queued"
  | "scheduled"
  | "publishing"
  | "posted"
  | "published"
  | "failed"
  | "cancelled";

export type PostingMode = "auto" | "approval" | "manual";

/**
 * Phase 20 (2026-05-24): per-config image-source policy.
 *   library_only = only attach photos the user uploaded; never
 *                  call Gemini even when the pool is empty.
 *   ai_only      = always call Gemini; ignore uploads.
 *   both         = upload first (rotated), fall back to Gemini
 *                  pool-building if pool is small. Recommended.
 */
export type ImageSource = "library_only" | "ai_only" | "both";
export type TriggeredBy = "manual" | "schedule";

export type MediaSource = "upload" | "ai_generated";

export type MediaLibraryRow = {
  id: string;
  user_id: string;
  ai_config_id: string | null;
  storage_path: string;
  public_url: string;
  source: MediaSource;
  tags: string[];
  ai_description: string | null;
  width: number | null;
  height: number | null;
  file_size_bytes: number | null;
  created_at: string;
};

export type MediaLibraryInsert = Partial<
  Omit<MediaLibraryRow, "id" | "created_at">
> & {
  user_id: string;
  storage_path: string;
  public_url: string;
  source: MediaSource;
};

export type MediaLibraryUpdate = Partial<
  Omit<MediaLibraryRow, "id" | "user_id" | "created_at">
>;

export type Schedule = {
  id: string;
  ai_config_id: string;
  user_id: string;
  hour: number;
  minute: number;
  weekdays: number[];
  enabled: boolean;
  created_at: string;
  updated_at: string;
};

export type ScheduleInsert = Partial<
  Omit<Schedule, "id" | "created_at" | "updated_at">
> & {
  ai_config_id: string;
  user_id: string;
  hour: number;
};

export type ScheduleUpdate = Partial<
  Omit<Schedule, "id" | "ai_config_id" | "user_id" | "created_at" | "updated_at">
>;

export type Plan = "free" | "standard" | "premium";

export type SubscriptionStatus =
  | "active"
  | "canceled"
  | "past_due"
  | "unpaid"
  | "incomplete"
  | "incomplete_expired"
  | "trialing";

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
  // Phase 9: Stripe billing columns
  stripe_customer_id: string | null;
  subscription_id: string | null;
  subscription_status: SubscriptionStatus | null;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  canceled_at: string | null;
  // Phase 12: AI image usage counter
  ai_images_used_this_period: number;
  ai_images_period_start: string | null;
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
  // Phase 15: OAuth 1.0a User Context tokens (per-account, encrypted).
  // Optional — when present we publish via OAuth 1.0a which our X App
  // supports for both v2 tweets and v1.1 media; falls back to the
  // existing OAuth 2.0 path when null.
  oauth1_access_token: string | null;
  oauth1_access_token_iv: string | null;
  oauth1_access_token_tag: string | null;
  oauth1_access_token_secret: string | null;
  oauth1_access_token_secret_iv: string | null;
  oauth1_access_token_secret_tag: string | null;
  scopes: string[] | null;
  token_type: string | null;
  platform_user_id: string | null;
  /** Phase 4 legacy NOT NULL column. Always equals platform_user_id. */
  platform_account_id: string;
  profile_image_url: string | null;
  status: SocialAccountStatus;
  is_primary: boolean;
  connected_at: string;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
};

// ---- OAuth sessions (Phase 6 — PKCE intermediate state) ------------------
export type Oauth1Pending = {
  oauth_token: string;
  user_id: string;
  oauth_token_secret_ciphertext: string;
  oauth_token_secret_iv: string;
  oauth_token_secret_tag: string;
  redirect_after: string | null;
  expires_at: string;
  created_at: string;
};

export type Oauth1PendingInsert = Partial<
  Omit<Oauth1Pending, "created_at" | "expires_at">
> & {
  oauth_token: string;
  user_id: string;
  oauth_token_secret_ciphertext: string;
  oauth_token_secret_iv: string;
  oauth_token_secret_tag: string;
  expires_at?: string;
};

export type Oauth1PendingUpdate = Partial<Omit<Oauth1Pending, "oauth_token">>;

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
  // -- Phase 11: auto-post --
  posting_mode: PostingMode;
  auto_post_enabled: boolean;
  // -- Phase 13: marketing strategy --
  monthly_goal: MonthlyGoalKey | null;
  target_audience_preset: string | null;
  target_audience_description: string | null;
  recent_topics: RecentTopicEntry[];
  // -- Phase 14: post length cap (X plan-dependent) --
  max_post_length: number;
  // -- Phase 16 (2026-05-22): per-config image attach toggle. When false,
  //    skip library lookup + Gemini fallback entirely (text-only).
  //    DEPRECATED in favour of image_source — kept for back-compat
  //    until a follow-up migration drops the column. --
  image_generation_enabled: boolean;
  // -- Phase 20 (2026-05-24): per-config image-source policy.
  //    'library_only' = only uploaded photos (no Gemini call)
  //    'ai_only'      = only Gemini (ignore uploaded photos)
  //    'both'         = upload → Gemini fallback (recommended default) --
  image_source: ImageSource;
  // -- Phase 17 (2026-05-22): content diversity. Pillars = 8 angles
  //    the AI rotates through (LLM-generated lazily). Each pillar:
  //    { id (kebab slug), name, description }. The anti-recency
  //    selector reads posts.pillar_id and weights by gap. --
  content_pillars: ContentPillar[];
  // ----------------------------------------------
  created_at: string;
  updated_at: string;
};

export type MonthlyGoalKey =
  | "new_customers"
  | "returning_customers"
  | "weekday_visits"
  | "higher_spend"
  | "brand_awareness"
  | "follower_growth";

export type RecentTopicEntry = {
  topic: string;
  last_used: string;
};

/**
 * Phase 17: a single "content pillar" — one of (typically) 8 distinct
 * angles the AI rotates through to keep posts feeling fresh. id is a
 * stable kebab-case slug used for anti-recency tracking (stored on
 * posts.pillar_id); name + description are what the prompt sees.
 */
export type ContentPillar = {
  id: string;
  name: string;
  description: string;
};

export type GenerationMetadata = {
  model?: string;
  input_tokens?: number;
  output_tokens?: number;
  cost_estimate?: number;
  generated_at?: string;
  prompt_strategy?: string;
  attempts?: string[];
  [key: string]: unknown;
};

/** Engagement metrics stored as jsonb on posts.engagement_data. */
export type EngagementData = {
  impressions?: number;
  likes?: number;
  retweets?: number;
  replies?: number;
  last_synced_at?: string | null;
  [key: string]: unknown;
};

export type Post = {
  id: string;
  user_id: string;
  ai_config_id: string | null;
  social_account_id: string | null;
  status: PostStatus;
  scheduled_at: string | null;
  published_at: string | null;
  posted_at: string | null;
  content: string;
  hashtags: string[];
  theme: string | null;
  image_url: string | null;
  image_prompt: string | null;
  image_storage_path: string | null;
  // Phase 6+: platform routing
  platform: Platform;
  platform_post_id: string | null;
  platform_post_url: string | null;
  // Approval workflow
  approved_by: string | null;
  approved_at: string | null;
  rejection_reason: string | null;
  // Phase 11: auto-post linkage
  triggered_by: TriggeredBy;
  schedule_id: string | null;
  approval_token: string | null;
  // Phase 12: image linkage. image_url already existed above; media_id is new.
  media_id: string | null;
  // Phase 13: strategy + topic tags
  strategic_intent: string | null;
  topic_tags: string[];
  // Phase 11.5: first 30 chars of content for opening-diversity tracking
  opening_snippet: string | null;
  // Phase 17: which content pillar produced this post + which image
  // was attached (media_library UUID as text, or the literal
  // "generated" for ephemeral Gemini images). Both nullable since
  // pre-Phase-17 posts predate this columns.
  pillar_id: string | null;
  image_ref: string | null;
  // Legacy column (kept for back-compat)
  external_post_id: string | null;
  /** All engagement metrics live in this jsonb (likes/retweets/etc). */
  engagement_data: EngagementData | null;
  generation_metadata: GenerationMetadata | null;
  retry_count: number;
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
      schedules: {
        Row: Schedule;
        Insert: ScheduleInsert;
        Update: ScheduleUpdate;
        Relationships: [];
      };
      media_library: {
        Row: MediaLibraryRow;
        Insert: MediaLibraryInsert;
        Update: MediaLibraryUpdate;
        Relationships: [];
      };
      oauth_sessions: {
        Row: OauthSession;
        Insert: OauthSessionInsert;
        Update: OauthSessionUpdate;
        Relationships: [];
      };
      oauth1_pending: {
        Row: Oauth1Pending;
        Insert: Oauth1PendingInsert;
        Update: Oauth1PendingUpdate;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
