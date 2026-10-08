// Anket örnek çözümünün Vercel'de çalışan sürümü (scripts/demo-yayin.mjs): server.mjs ile aynı API, veriler Upstash Redis'te.
// Oylar HINCRBY ve SADD ile atomik: aynı anda gelen oylar kaybolmaz, aynı kişi iki kez oy veremez. Hata açma (HATALAR) yok.
import { authPages, err, html, id, json, serve } from "../ortak.mjs";
import { kv, kvAuth, kvPipe, TTL } from "../kv.mjs";
import { DETAY, LISTE, YENI } from "./sayfalar.mjs";

const P = "anket";
const A = kvAuth(P);
const k = (aid, ek = "") => `${P}:a:${aid}${ek}`;
const LISTE_KEY = `${P}:liste`;

/** Anketleri depodan okur: [{ a, kapali, oylar }] (olmayan anket null). */
async function oku(ids) {
  if (!ids.length) return [];
  const r = await kvPipe(ids.flatMap((aid) => [["GET", k(aid)], ["GET", k(aid, ":kapali")], ["HGETALL", k(aid, ":oy")]]));
  return ids.map((_, i) => {
    const [raw, kapali, flat] = r.slice(i * 3, i * 3 + 3);
    if (!raw) return null;
    const oylar = {};
    for (let j = 0; j < (flat ?? []).length; j += 2) oylar[flat[j]] = Number(flat[j + 1]);
    return { a: JSON.parse(raw), kapali: kapali === "1", oylar };
  });
}

function gorunum({ a, kapali, oylar }) {
  const sec = a.secenekler.map((x) => ({ ...x, oy: oylar[x.id] ?? 0 }));
  const toplam = sec.reduce((s, x) => s + x.oy, 0);
  return {
    id: a.id,
    soru: a.soru,
    acik: !kapali,
    toplamOy: toplam,
    secenekler: sec.map((x) => ({ id: x.id, metin: x.metin, oy: x.oy, yuzde: toplam ? Math.round((x.oy / toplam) * 100) : 0 })),
  };
}

async function bul(ctx) {
  const [d] = /^[0-9a-f]{12}$/.test(ctx.params.id) ? await oku([ctx.params.id]) : [null];
  if (!d) err(ctx.res, 404, "Anket yok.");
  return d;
}

serve([
  ...authPages(),
  ["GET", "/", ({ res }) => html(res, LISTE)],
  ["GET", "/anket/yeni", ({ res }) => html(res, YENI)],
  ["GET", "/anket/:id", ({ res }) => html(res, DETAY)],
  ["POST", "/api/kayit", A.register],
  ["POST", "/api/giris", A.login],
  [
    "GET",
    "/api/anketler",
    async ({ res }) => {
      const list = (await oku((await kv("LRANGE", LISTE_KEY, 0, -1)) ?? [])).filter(Boolean).map(gorunum);
      json(res, 200, list.map((a) => ({ id: a.id, soru: a.soru, acik: a.acik, toplamOy: a.toplamOy })));
    },
  ],
  [
    "POST",
    "/api/anketler",
    async (ctx) => {
      const u = await A.user(ctx);
      if (!u) return;
      const soru = String(ctx.body.soru ?? "").trim();
      const sec = Array.isArray(ctx.body.secenekler) ? ctx.body.secenekler.map((s) => String(s).trim()).filter(Boolean) : [];
      if (!soru || sec.length < 2 || sec.length > 6) return err(ctx.res, 400, "Soru ve 2-6 seçenek gerekli.");
      const a = { id: id(), soru: soru.slice(0, 300), sahip: u.eposta, secenekler: sec.map((metin) => ({ id: id(), metin: metin.slice(0, 200) })) };
      await kvPipe([
        ["SET", k(a.id), JSON.stringify(a), "EX", TTL],
        ["RPUSH", LISTE_KEY, a.id],
        ["LTRIM", LISTE_KEY, -300, -1],
        ["EXPIRE", LISTE_KEY, TTL],
      ]);
      json(ctx.res, 201, gorunum({ a, kapali: false, oylar: {} }));
    },
  ],
  [
    "GET",
    "/api/anketler/:id",
    async (ctx) => {
      const d = await bul(ctx);
      if (d) json(ctx.res, 200, gorunum(d));
    },
  ],
  [
    "POST",
    "/api/anketler/:id/oy",
    async (ctx) => {
      const u = await A.user(ctx);
      if (!u) return;
      const d = await bul(ctx);
      if (!d) return;
      if (d.kapali) return err(ctx.res, 409, "Anket kapalı.");
      const s = d.a.secenekler.find((x) => x.id === ctx.body.secenekId);
      if (!s) return err(ctx.res, 400, "Böyle bir seçenek yok.");
      if ((await kv("SADD", k(d.a.id, ":oylayan"), u.eposta)) === 0) return err(ctx.res, 409, "Zaten oy verdin.");
      await kvPipe([
        ["HINCRBY", k(d.a.id, ":oy"), s.id, 1],
        ["EXPIRE", k(d.a.id, ":oy"), TTL],
        ["EXPIRE", k(d.a.id, ":oylayan"), TTL],
      ]);
      json(ctx.res, 200, gorunum((await oku([d.a.id]))[0]));
    },
  ],
  [
    "POST",
    "/api/anketler/:id/kapat",
    async (ctx) => {
      const u = await A.user(ctx);
      if (!u) return;
      const d = await bul(ctx);
      if (!d) return;
      if (d.a.sahip !== u.eposta) return err(ctx.res, 403, "Sadece anketi açan kapatabilir.");
      await kv("SET", k(d.a.id, ":kapali"), "1", "EX", TTL);
      json(ctx.res, 200, gorunum({ ...d, kapali: true }));
    },
  ],
]);
