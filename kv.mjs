// Sunucusuz yayın (scripts/demo-yayin.mjs) için ortak depo: Upstash Redis'in REST API'si (Vercel Marketplace, ücretsiz).
// Vercel aynı anda birden fazla örnek çalıştırdığı için veri bellekte tutulamaz; kayıt bir örnekte, giriş başka örnekte olabilir.
// Bütün anahtarlar 7 gün sonra silinir (testler her seferinde kendi verisini açar).
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { err, id, json } from "./ortak.mjs";

const BASE = (process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL ?? "").replace(/\/$/, "");
const TOKEN = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN ?? "";
export const TTL = 7 * 24 * 3600;

async function call(path, body) {
  if (!BASE || !TOKEN) throw new Error("KV_REST_API_URL / KV_REST_API_TOKEN yok");
  const r = await fetch(BASE + path, { method: "POST", headers: { Authorization: `Bearer ${TOKEN}` }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok || j.error) throw new Error(`kv: ${j.error ?? r.status}`);
  return j;
}

/** Tek komut: kv("SET", "k", "v", "NX") */
export const kv = async (...cmd) => (await call("", cmd)).result;

/** Birden fazla komut tek istekte (sırayla çalışır; her komut kendi içinde atomik). */
export const kvPipe = async (cmds) =>
  (await call("/pipeline", cmds)).map((x) => {
    if (x.error) throw new Error(`kv: ${x.error}`);
    return x.result;
  });

/** ortak.mjs'teki auth() ile aynı davranış, veriler depoda. */
export function kvAuth(p) {
  const hash = (s, salt) => scryptSync(s, salt, 32);

  async function register({ body, res }) {
    const eposta = String(body?.eposta ?? "").trim().toLowerCase();
    const sifre = String(body?.sifre ?? "");
    const ad = String(body?.ad ?? "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(eposta)) return err(res, 400, "Geçerli bir e-posta gir.");
    if (sifre.length < 8) return err(res, 400, "Şifre en az 8 karakter olmalı.");
    if (!ad) return err(res, 400, "Adını yaz.");
    const salt = randomBytes(16);
    const u = { id: id(), eposta, ad, salt: salt.toString("hex"), hash: hash(sifre, salt).toString("hex") };
    if ((await kv("SET", `${p}:u:${eposta}`, JSON.stringify(u), "NX", "EX", TTL)) !== "OK") return err(res, 409, "Bu e-postayla bir hesap var.");
    return json(res, 201, { id: u.id, eposta, ad });
  }

  async function login({ body, res }) {
    const raw = await kv("GET", `${p}:u:${String(body?.eposta ?? "").trim().toLowerCase()}`);
    const u = raw ? JSON.parse(raw) : null;
    if (!u || !timingSafeEqual(Buffer.from(u.hash, "hex"), hash(String(body?.sifre ?? ""), Buffer.from(u.salt, "hex")))) return err(res, 401, "E-posta ya da şifre yanlış.");
    const token = randomBytes(24).toString("hex");
    await kv("SET", `${p}:t:${token}`, u.eposta, "EX", TTL);
    return json(res, 200, { token });
  }

  /** Token'dan kullanıcı; yoksa 401 yazar ve null döner. */
  async function user(ctx) {
    const h = ctx.headers.authorization ?? "";
    const t = h.startsWith("Bearer ") ? h.slice(7) : "";
    const e = /^[0-9a-f]{48}$/.test(t) ? await kv("GET", `${p}:t:${t}`) : null;
    const raw = e ? await kv("GET", `${p}:u:${e}`) : null;
    if (!raw) {
      err(ctx.res, 401, "Giriş yapmalısın.");
      return null;
    }
    return JSON.parse(raw);
  }

  return { register, login, user };
}
