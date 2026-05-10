import type { Post } from "@/lib/supabase/types";

export type PostListItem = Post & {
  ai_config: { id: string; name: string; account_mode: string } | null;
  social_account: {
    id: string;
    username: string;
    display_name: string | null;
    platform: string;
  } | null;
};
