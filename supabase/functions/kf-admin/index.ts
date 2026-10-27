// KF Production admin Edge Function. Deploy as function name: kf-admin.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
};
const respond = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
    if (!url || !key) return respond({ error: "Supabase function environment is not configured." }, 500);
    const urlObj = new URL(req.url);
    const path = urlObj.pathname.split("/kf-admin")[1]?.replace(/\/$/, "") || "/";

    // Public catalog endpoint: only returns titles published in the public catalog.
    if (path === "/public/catalog" && req.method === "GET") {
      const publicClient = createClient(url, key, { auth: { persistSession: false } });
      const { data, error } = await publicClient.from("kf_catalog").select("id,payload,created_at").order("created_at", { ascending: false });
      if (error) return respond({ error: error.message }, 400);
      return respond({ items: (data || []).map((row: any) => ({ ...row.payload, id: row.id })) });
    }

    const authorization = req.headers.get("Authorization");
    if (!authorization?.startsWith("Bearer ")) return respond({ error: "Сначала войди в аккаунт." }, 401);

    // Use the caller's JWT: all database/storage actions retain RLS and user identity.
    const sb = createClient(url, key, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } });
    const { data: { user }, error: authError } = await sb.auth.getUser();
    if (authError || !user) return respond({ error: "Сессия не найдена. Войди снова." }, 401);
    const { data: isAdmin, error: roleError } = await sb.rpc("is_kf_admin");
    if (roleError || isAdmin !== true) return respond({ error: "Нет прав администратора." }, 403);

    const body = ["POST", "PUT", "PATCH"].includes(req.method) ? await req.json().catch(() => ({})) : {};

    if (path === "/me" && req.method === "GET") return respond({ authenticated: true, user: { id: user.id, email: user.email } });

    if (path === "/catalog" && req.method === "GET") {
      const { data, error } = await sb.from("kf_catalog").select("*").order("created_at", { ascending: false });
      if (error) return respond({ error: error.message }, 400);
      return respond({ items: (data || []).map((r: any) => ({ ...r.payload, id: r.id })) });
    }

    if (path === "/catalog" && req.method === "POST") {
      const item = validateItem(body);
      if (!item) return respond({ error: "Укажи название и видео." }, 400);
      const id = String((body as any).id || crypto.randomUUID());
      const { error } = await sb.from("kf_catalog").insert({ id, payload: item, updated_by: user.id });
      if (error) return respond({ error: error.message }, 400);
      return respond({ ok: true, id, message: "Публикация добавлена." });
    }

    const itemMatch = path.match(/^\/catalog\/([a-zA-Z0-9_-]+)$/);
    if (itemMatch && ["PUT", "PATCH"].includes(req.method)) {
      const item = validateItem(body);
      if (!item) return respond({ error: "Укажи название и видео." }, 400);
      const { error } = await sb.from("kf_catalog").update({ payload: item, updated_by: user.id }).eq("id", itemMatch[1]);
      if (error) return respond({ error: error.message }, 400);
      return respond({ ok: true, message: "Изменения сохранены." });
    }
    if (itemMatch && req.method === "DELETE") {
      const { error } = await sb.from("kf_catalog").delete().eq("id", itemMatch[1]);
      if (error) return respond({ error: error.message }, 400);
      return respond({ ok: true });
    }

    if (path === "/upload" && req.method === "POST") {
      const kind = (body as any).kind;
      const filename = String((body as any).filename || "upload.bin").replace(/[^\p{L}\p{N}._-]+/gu, "_").slice(-120);
      const encoded = String((body as any).data || "");
      if (!["poster", "video"].includes(kind) || !encoded) return respond({ error: "Некорректный файл." }, 400);
      const raw = atob(encoded);
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
      const max = kind === "poster" ? 5 * 1024 * 1024 : 80 * 1024 * 1024;
      if (bytes.byteLength > max) return respond({ error: "Файл слишком большой." }, 413);
      const ext = filename.split(".").pop()?.toLowerCase() || "";
      const allowed = kind === "poster" ? ["jpg", "jpeg", "png", "webp", "gif"] : ["mp4", "webm"];
      if (!allowed.includes(ext)) return respond({ error: "Этот формат файла не поддерживается." }, 400);
      const bucket = "kf-media";
      const objectPath = `${kind}s/${crypto.randomUUID()}-${filename}`;
      const { error } = await sb.storage.from(bucket).upload(objectPath, bytes, {
        contentType: kind === "poster" ? (ext === "jpg" ? "image/jpeg" : `image/${ext}`) : (ext === "webm" ? "video/webm" : "video/mp4"),
        upsert: false,
      });
      if (error) return respond({ error: error.message }, 400);
      const { data: publicUrl } = sb.storage.from(bucket).getPublicUrl(objectPath);
      return respond({ path: publicUrl.publicUrl });
    }

    if (path === "/admins" && req.method === "GET") {
      const { data, error } = await sb.rpc("kf_list_admins");
      if (error) return respond({ error: error.message }, 400);
      return respond({ admins: data || [] });
    }
    if (path === "/admins" && req.method === "POST") {
      const target = String((body as any).user_id || "");
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(target))
        return respond({ error: "Укажи корректный UUID пользователя из Supabase → Authentication → Users." }, 400);
      const { error } = await sb.rpc("kf_add_admin", { target_user_id: target });
      if (error) return respond({ error: error.message }, 400);
      return respond({ ok: true });
    }
    const adminMatch = path.match(/^\/admins\/([0-9a-f-]+)$/i);
    if (adminMatch && req.method === "DELETE") {
      if (adminMatch[1] === user.id) return respond({ error: "Нельзя снять собственные права здесь." }, 400);
      const { error } = await sb.rpc("kf_remove_admin", { target_user_id: adminMatch[1] });
      if (error) return respond({ error: error.message }, 400);
      return respond({ ok: true });
    }

    return respond({ error: "Маршрут не найден." }, 404);
  } catch (e) {
    return respond({ error: e instanceof Error ? e.message : "Внутренняя ошибка." }, 500);
  }
});

function validateItem(input: any) {
  if (!input || typeof input.title !== "string" || !input.title.trim() ||
      typeof input.video !== "string" || !input.video.trim()) return null;
  return {
    title: input.title.trim().slice(0, 160),
    kind: input.kind === "series" ? "series" : "movie",
    year: String(input.year || "").slice(0, 4),
    genre: String(input.genre || "").slice(0, 100),
    description: String(input.description || "").slice(0, 4000),
    poster: String(input.poster || "").slice(0, 1000),
    video: input.video.trim().slice(0, 2000),
    videoTitle: String(input.videoTitle || "").slice(0, 160),
    trailer: String(input.trailer || "").slice(0, 2000),
    cast: Array.isArray(input.cast) ? input.cast.slice(0, 60) : [],
  };
}
