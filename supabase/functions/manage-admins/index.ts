// manage-admins: lets a club admin list, add, remove and reset the password of that club's admins.
// Runs with the service role (needed to create auth users), so it checks itself that the caller runs the club.
// Body (all with club_id): { action: 'list' } | { action: 'add', email, password? } | { action: 'remove', id } | { action: 'reset', id, password }
// A password can only be reset for someone whose every club is also run by the caller, so an admin of a
// small club cannot take over an account that also runs another club.
// New admins get a password set here (no email is sent: the built-in Supabase mailer only reaches project team members).
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  try {
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: who, error: whoErr } = await sb.auth.getUser(jwt);
    if (whoErr || !who.user) return json({ error: "not_signed_in" }, 401);
    const me = who.user.id;
    const body = await req.json().catch(() => ({}));
    const club = Number(body.club_id);
    if (!Number.isInteger(club)) return json({ error: "no_club" }, 400);
    const clubsOf = async (uid: string) => {
      const { data, error } = await sb.from("club_admins").select("club_id").eq("user_id", uid);
      if (error) throw error;
      return (data || []).map((r) => Number(r.club_id));
    };
    const myClubs = await clubsOf(me);
    if (!myClubs.includes(club)) return json({ error: "not_admin" }, 403);

    const list = async () => {
      const { data: rows, error } = await sb.from("club_admins").select("user_id, created_at").eq("club_id", club).order("created_at");
      if (error) throw error;
      const out = [];
      for (const r of rows || []) {
        const { data } = await sb.auth.admin.getUserById(r.user_id);
        out.push({ id: r.user_id, email: data.user?.email || "", me: r.user_id === me, last_sign_in_at: data.user?.last_sign_in_at || null });
      }
      return out;
    };
    const findByEmail = async (email: string) => {
      for (let page = 1; page < 50; page++) {
        const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 200 });
        if (error) throw error;
        const hit = data.users.find((u) => (u.email || "").toLowerCase() === email);
        if (hit) return hit;
        if (data.users.length < 200) return null;
      }
      return null;
    };

    if (body.action === "list") return json({ admins: await list() });

    if (body.action === "add") {
      const email = String(body.email || "").trim().toLowerCase();
      const password = String(body.password || "");
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "bad_email" }, 400);
      let user = await findByEmail(email);
      let created = false;
      if (!user) {
        if (password.length < 8) return json({ error: "short_password" }, 400);
        const { data, error } = await sb.auth.admin.createUser({ email, password, email_confirm: true });
        if (error) throw error;
        user = data.user;
        created = true;
      }
      const { error } = await sb.from("club_admins").upsert({ club_id: club, user_id: user!.id }, { onConflict: "club_id,user_id", ignoreDuplicates: true });
      if (error) throw error;
      return json({ admins: await list(), created });
    }

    if (body.action === "remove") {
      const id = String(body.id || "");
      if (id === me) return json({ error: "cannot_remove_self" }, 400);
      const { count } = await sb.from("club_admins").select("user_id", { count: "exact", head: true }).eq("club_id", club);
      if ((count || 0) <= 1) return json({ error: "last_admin" }, 400);
      const { error } = await sb.from("club_admins").delete().eq("club_id", club).eq("user_id", id);
      if (error) throw error;
      return json({ admins: await list() });
    }

    if (body.action === "reset") {
      const id = String(body.id || "");
      const password = String(body.password || "");
      if (id === me) return json({ error: "use_change_password" }, 400);
      if (password.length < 8) return json({ error: "short_password" }, 400);
      const theirs = await clubsOf(id);
      if (!theirs.includes(club)) return json({ error: "not_admin_target" }, 400);
      if (!theirs.every((c) => myClubs.includes(c))) return json({ error: "other_club_admin" }, 403);
      const { error } = await sb.auth.admin.updateUserById(id, { password });
      if (error) throw error;
      return json({ admins: await list() });
    }

    return json({ error: "unknown_action" }, 400);
  } catch (e) {
    return json({ error: (e as Error).message || "server_error" }, 500);
  }
});
