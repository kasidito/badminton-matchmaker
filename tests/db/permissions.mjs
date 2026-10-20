/* Replays every migration in an in-process Postgres (PGlite) with small stand-ins for Supabase's auth schema
   and roles, then runs tests/db/permissions.sql, which acts as different users and prints what each could do.
   Run: npm run test:db   (needs devDependency @electric-sql/pglite) */
import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const db = new PGlite();
// minimal stand-ins for what Supabase provides
await db.exec(`
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth;
create table auth.users (id uuid primary key, email text, aud text, role text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claims', true)::json->>'sub','')::uuid $$;
grant usage on schema auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;
grant usage on schema public to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
insert into auth.users values ('f47ae5db-c3e3-41e3-a70a-5db90453da8c','owner@x','authenticated','authenticated');
`);
const files = fs.readdirSync(repo + '/supabase/migrations').sort();
for (const f of files) {
  let sql = fs.readFileSync(repo + '/supabase/migrations/' + f, 'utf8');
  if (f.startsWith('20261020090000')) sql += `\ninsert into public.admins(user_id) values ('f47ae5db-c3e3-41e3-a70a-5db90453da8c');`;
  try { await db.exec(sql); console.log('applied', f); } catch (e) { console.log('FAILED', f, e.message); process.exit(1); }
}
const sql = fs.readFileSync(path.join(repo, 'tests/db/permissions.sql'), 'utf8');
let out = '';
try { await db.exec(sql); } catch (e) { out = e.message; }
console.log(out);
const bad = /ALLOWED\(BAD\)|FAILED/.test(out) || !out.startsWith('RESULT');
console.log(bad ? 'FAIL: a permission check did not hold' : 'ok   all permission checks held');
process.exit(bad ? 1 : 0);
