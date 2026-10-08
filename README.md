# Anket

TLTpulse "Anket" yarışması teslimi. Bağımlılıksız Node; Vercel'de çalışıyor, veriler Upstash Redis'te.

Canlı: https://tlt-ornek-anket.vercel.app

- `app/sunucusuz.mjs`: API (kayıt, giriş, anket aç, oy ver, kapat)
- `app/sayfalar.mjs`: arayüz (`/`, `/anket/yeni`, `/anket/:id`, `/giris`, `/kayit`)
- `kv.mjs`: Upstash REST istemcisi (`KV_REST_API_URL`, `KV_REST_API_TOKEN`)
