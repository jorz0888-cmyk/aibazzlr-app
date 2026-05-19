import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, MediaLibraryRow } from "@/lib/supabase/types";

export const MEDIA_BUCKET = "user-media";
export const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MiB — matches X v1.1 photo limit.
export const ALLOWED_MIMES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);

export function extForMime(mime: string): string {
  if (mime === "image/jpeg" || mime === "image/jpg") return "jpg";
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  return "bin";
}

export function buildStoragePath(
  userId: string,
  aiConfigId: string | null,
  filename: string,
): string {
  const folder = aiConfigId ?? "general";
  return `${userId}/${folder}/${filename}`;
}

type Client = SupabaseClient<Database>;

export async function uploadToUserMedia(
  client: Client,
  storagePath: string,
  body: ArrayBuffer | Blob | File,
  contentType: string,
): Promise<{ publicUrl: string }> {
  const { error: uploadErr } = await client.storage
    .from(MEDIA_BUCKET)
    .upload(storagePath, body, {
      contentType,
      upsert: false,
    });
  if (uploadErr) {
    throw new Error(`Storage upload failed: ${uploadErr.message}`);
  }
  const { data } = client.storage.from(MEDIA_BUCKET).getPublicUrl(storagePath);
  return { publicUrl: data.publicUrl };
}

export async function deleteFromUserMedia(
  client: Client,
  storagePath: string,
): Promise<void> {
  const { error } = await client.storage
    .from(MEDIA_BUCKET)
    .remove([storagePath]);
  if (error) {
    // Best effort — if the file is already gone, we still want to clean the
    // DB row, so swallow the error after logging.
    console.warn("[media/storage] delete failed", error);
  }
}

export type MediaListResult = MediaLibraryRow;
