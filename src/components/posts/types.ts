import type { Post } from "@/lib/supabase/types";

export type PostListItem = Post & {
  ai_config: {
    id: string;
    name: string;
    account_mode: string;
    /** Phase 14: per-config post-length cap (X plan-dependent). */
    max_post_length: number;
  } | null;
  social_account: {
    id: string;
    username: string;
    display_name: string | null;
    platform: string;
  } | null;
};
