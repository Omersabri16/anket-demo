// Örnek çözümlerin ortak küçük sunucu çatısı (bağımlılıksız, sadece Node). Testleri doğrulamak için yazıldı:
// gizli testler bu çözümlerde %100 geçmeli. Veriler bellekte; gerçek bir takım veritabanı kullanır.
// HATALAR ortam değişkeni (virgülle) bilerek hata açar: demo takımlarının farklı sonuç alması ve testlerin
// gerçekten hata yakaladığını göstermek için.
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import http from "node:http";

export const HATALAR = new Set((process.env.HATALAR ?? "").split(",").map((s) => s.trim()).filter(Boolean));
export const hata = (ad) => HATALAR.has(ad);

export const id = () => randomBytes(6).toString("hex");

export function json(res, status, body) {
  const text = body === undefined ? "" : JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(text);
}

export function html(res, body) {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  res.end(body);
}

export const err = (res, status, mesaj) => json(res, status, { hata: mesaj });

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 1_000_000) throw new Error("çok büyük");
    chunks.push(c);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Vercel'de (scripts/demo-yayin.mjs) sunucu açılmaz; api/index.mjs bu işleyiciyi kullanır. */
export let handler = null;

/** Basit yönlendirici: [method, "/api/x/:id", handler(ctx)] */
export function serve(routes, { port = Number(process.env.PORT ?? 3000) } = {}) {
  const compiled = routes.map(([method, path, fn]) => {
    const keys = [];
    const re = new RegExp("^" + path.replace(/:[a-zA-Z]+/g, (k) => (keys.push(k.slice(1)), "([^/]+)")) + "/?$");
    return { method, re, keys, fn };
  });
  handler = async (req, res) => {
    try {
      const url = new URL(req.url, "http://x");
      for (const r of compiled) {
        if (r.method !== req.method) continue;
        const m = url.pathname.match(r.re);
        if (!m) continue;
        const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
        const body = ["POST", "PUT", "PATCH", "DELETE"].includes(req.method) ? await readBody(req) : {};
        if (body === null) return err(res, 400, "Geçersiz JSON");
        return await r.fn({ req, res, params, query: url.searchParams, body, headers: req.headers });
      }
      if (url.pathname.startsWith("/api/")) return err(res, 404, "Bulunamadı");
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Bulunamadı");
    } catch (e) {
      console.error(e);
      if (!res.headersSent) err(res, 500, "Sunucu hatası");
    }
  };
  if (process.env.VERCEL) return null;
  const server = http.createServer(handler);
  server.listen(port, () => console.log(`örnek çözüm http://localhost:${port}`));
  return server;
}

// ---------- Kimlik ----------

export function auth({ roller } = {}) {
  const users = new Map(); // eposta -> kullanıcı
  const tokens = new Map(); // token -> eposta
  const hash = (s, salt) => scryptSync(s, salt, 32);

  function register({ body, res }) {
    const eposta = String(body?.eposta ?? "").trim().toLowerCase();
    const sifre = String(body?.sifre ?? "");
    const ad = String(body?.ad ?? "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(eposta)) return err(res, 400, "Geçerli bir e-posta gir.");
    if (sifre.length < 8 && !hata("kisa-sifre")) return err(res, 400, "Şifre en az 8 karakter olmalı.");
    if (!ad) return err(res, 400, "Adını yaz.");
    let rol;
    if (roller) {
      rol = body?.rol;
      if (!roller.includes(rol)) return err(res, 400, "Geçersiz rol.");
    }
    if (users.has(eposta)) return err(res, 409, "Bu e-postayla bir hesap var.");
    const salt = randomBytes(16);
    const u = { id: id(), eposta, ad, rol, salt, hash: hash(sifre, salt) };
    users.set(eposta, u);
    return json(res, 201, { id: u.id, eposta, ad, ...(rol ? { rol } : {}) });
  }

  function login({ body, res }) {
    const u = users.get(String(body?.eposta ?? "").trim().toLowerCase());
    const sifre = String(body?.sifre ?? "");
    if (!u || !timingSafeEqual(u.hash, hash(sifre, u.salt))) return err(res, 401, "E-posta ya da şifre yanlış.");
    const token = randomBytes(24).toString("hex");
    tokens.set(token, u.eposta);
    return json(res, 200, { token, ...(u.rol ? { rol: u.rol } : {}) });
  }

  /** Token'dan kullanıcı; yoksa 401 yazar ve null döner. */
  function user(ctx) {
    const h = ctx.headers.authorization ?? "";
    const t = h.startsWith("Bearer ") ? h.slice(7) : "";
    const e = tokens.get(t);
    const u = e && users.get(e);
    if (!u) {
      err(ctx.res, 401, "Giriş yapmalısın.");
      return null;
    }
    return u;
  }

  return { register, login, user, users };
}

// ---------- Sayfalar ----------

export const page = (title, body, script = "") => `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><style>
body{font-family:system-ui,sans-serif;max-width:760px;margin:24px auto;padding:0 16px;color:#16163a;background:#fafafa}
input,select,button{font:inherit;padding:8px 10px;margin:4px 0;border:1px solid #aaa;border-radius:8px}button{background:#5249d0;color:#fff;border:0;cursor:pointer}
li{margin:6px 0}.hata{color:#b00020}.kart{border:1px solid #ddd;border-radius:12px;padding:12px;margin:8px 0;background:#fff}
a{color:#3b34a8}label{display:block}
</style></head><body><main>${body}</main><script>
const tok=()=>localStorage.getItem("token");
async function api(m,p,b){const r=await fetch(p,{method:m,headers:{"Content-Type":"application/json",...(tok()?{Authorization:"Bearer "+tok()}:{})},body:b?JSON.stringify(b):undefined});let j=null;try{j=await r.json()}catch{}return{status:r.status,ok:r.ok,body:j}}
const esc=s=>String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
${script}
</script></body></html>`;

/** /giris ve /kayit sayfaları (Orta ve Zor şartnamelerde ortak). */
export function authPages({ roller } = {}) {
  const kayit = page(
    "Kayıt",
    `<h1>Kayıt ol</h1><form id="f">
<label>Ad <input data-testid="kayit-ad" required></label>
<label>E-posta <input data-testid="kayit-eposta" type="email" required></label>
<label>Şifre <input data-testid="kayit-sifre" type="password" required></label>
${roller ? `<label>Rol <select data-testid="kayit-rol">${roller.map((r) => `<option value="${r}">${r}</option>`).join("")}</select></label>` : ""}
<button data-testid="kayit-gonder">Kayıt ol</button></form><p data-testid="hata-mesaji" class="hata" hidden></p><a href="/giris">Giriş</a>`,
    `document.getElementById("f").onsubmit=async e=>{e.preventDefault();const q=s=>document.querySelector('[data-testid="'+s+'"]');
const r=await api("POST","/api/kayit",{ad:q("kayit-ad").value,eposta:q("kayit-eposta").value,sifre:q("kayit-sifre").value${roller ? ',rol:q("kayit-rol").value' : ""}});
if(r.ok)location.href="/giris";else{const h=q("hata-mesaji");h.hidden=false;h.textContent=r.body?.hata||"Hata"}}`,
  );
  const giris = page(
    "Giriş",
    `<h1>Giriş yap</h1><form id="f">
<label>E-posta <input data-testid="giris-eposta" type="email" required></label>
<label>Şifre <input data-testid="giris-sifre" type="password" required></label>
<button data-testid="giris-gonder">Giriş yap</button></form><p data-testid="hata-mesaji" class="hata" hidden></p><a href="/kayit">Kayıt ol</a>`,
    `document.getElementById("f").onsubmit=async e=>{e.preventDefault();const q=s=>document.querySelector('[data-testid="'+s+'"]');
const r=await api("POST","/api/giris",{eposta:q("giris-eposta").value,sifre:q("giris-sifre").value});
if(r.ok){localStorage.setItem("token",r.body.token);if(r.body.rol)localStorage.setItem("rol",r.body.rol);localStorage.setItem("eposta",q("giris-eposta").value);location.href="/"}else{const h=q("hata-mesaji");h.hidden=false;h.textContent=r.body?.hata||"Hata"}}`,
  );
  return [
    ["GET", "/kayit", ({ res }) => html(res, kayit)],
    ["GET", "/giris", ({ res }) => html(res, giris)],
  ];
}

// ---------- Canlı yayın (SSE) ----------

export function hub() {
  const subs = new Set();
  return {
    sse({ req, res }) {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" });
      res.write(": bağlandı\n\n");
      subs.add(res);
      const ping = setInterval(() => res.write(": ping\n\n"), 15000);
      req.on("close", () => {
        clearInterval(ping);
        subs.delete(res);
      });
    },
    send(data) {
      for (const s of subs) s.write(`data: ${JSON.stringify(data)}\n\n`);
    },
  };
}
