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
  avatar_url: string | null;
  access_token: string | null;
  refresh_token: string | null;
  token_expires_at: string | null;
  status: SocialAccountStatus;
  is_primary: boolean;
  connected_at: string;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
};

export type AiConfig = {
  id: string;
  user_id: string;
  name: string;
  industry: string | null;
  world_view: string | null;
  voice_tone: string | null;
  ng_words: string[];
  good_examples: string[];
  hashtags: string[];
  is_default: boolean;
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
  default_ng_words: string[];
  default_good_examples: string[];
  default_hashtags: string[];
  is_active: boolean;
  display_order: number;
  created_at: string;
  updated_at: string;
};

// ---- Insert / Update payloads -------------------------------------------
type Insertable<T extends { id: string; created_at: string; updated_at: string }> = Omit<
  T,
  "id" | "created_at" | "updated_at"
> &
  Partial<Pick<T, "id">>;

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
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
