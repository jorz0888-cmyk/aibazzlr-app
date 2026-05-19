import { NextResponse, type NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import {
  ALLOWED_MIMES,
  MAX_FILE_BYTES,
  buildStoragePath,
  extForMime,
  uploadToUserMedia,
} from "@/lib/media/storage";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch (e) {
    return NextResponse.json(
      {
        error: `フォームデータの読み込みに失敗しました: ${
          e instanceof Error ? e.message : String(e)
        }`,
      },
      { status: 400 },
    );
  }

  const aiConfigIdRaw = form.get("ai_config_id");
  const aiConfigId =
    typeof aiConfigIdRaw === "string" && aiConfigIdRaw ? aiConfigIdRaw : null;
  const tagsRaw = form.get("tags");
  const initialTags =
    typeof tagsRaw === "string" && tagsRaw
      ? tagsRaw
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean)
      : [];

  // If ai_config_id is provided, confirm ownership.
  if (aiConfigId) {
    const { data: cfg } = await supabase
      .from("ai_configs")
      .select("id, user_id")
      .eq("id", aiConfigId)
      .single();
    if (!cfg || cfg.user_id !== user.id) {
      return NextResponse.json(
        { error: "AI 設定が見つかりません" },
        { status: 404 },
      );
    }
  }

  // Allow either one "file" field or multiple "files" / "file" entries.
  const fileEntries = form.getAll("file").filter((v): v is File => v instanceof File);
  if (fileEntries.length === 0) {
    return NextResponse.json(
      { error: "アップロードするファイルがありません" },
      { status: 400 },
    );
  }

  const uploaded: unknown[] = [];
  for (const file of fileEntries) {
    if (file.size === 0) continue;
    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json(
        {
          error: `ファイルが大きすぎます（5MB 以内）: ${file.name}`,
        },
        { status: 413 },
      );
    }
    if (!ALLOWED_MIMES.has(file.type)) {
      return NextResponse.json(
        {
          error: `サポートされていない形式です（jpg / png / webp のみ）: ${file.type || file.name}`,
        },
        { status: 415 },
      );
    }

    const ext = extForMime(file.type);
    const id = randomUUID();
    const path = buildStoragePath(user.id, aiConfigId, `${id}.${ext}`);

    const buffer = await file.arrayBuffer();
    let publicUrl: string;
    try {
      const res = await uploadToUserMedia(supabase, path, buffer, file.type);
      publicUrl = res.publicUrl;
    } catch (e) {
      console.error("[media/upload] storage upload failed", e);
      return NextResponse.json(
        {
          error: e instanceof Error ? e.message : "アップロードに失敗しました",
        },
        { status: 502 },
      );
    }

    const { data: row, error } = await supabase
      .from("media_library")
      .insert({
        user_id: user.id,
        ai_config_id: aiConfigId,
        storage_path: path,
        public_url: publicUrl,
        source: "upload",
        tags: initialTags,
        file_size_bytes: file.size,
      })
      .select("*")
      .single();
    if (error) {
      console.error("[media/upload] db insert failed", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    uploaded.push(row);
  }

  return NextResponse.json({ media: uploaded });
}
