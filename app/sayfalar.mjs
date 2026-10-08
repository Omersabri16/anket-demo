// Anket örnek çözümünün sayfaları (server.mjs ve sunucusuz.mjs ortak kullanır).
import { page } from "../ortak.mjs";

export const LISTE = page(
  "Anketler",
  `<p><a href="/anket/yeni">Yeni anket</a> · <a href="/giris">Giriş</a></p><h1>Anketler</h1><div data-testid="anket-listesi" id="l"></div>`,
  `api("GET","/api/anketler").then(r=>{document.getElementById("l").innerHTML=(r.body||[]).map(a=>'<a class="kart" style="display:block" data-testid="anket-karti" href="/anket/'+a.id+'">'+esc(a.soru)+' · '+a.toplamOy+' oy'+(a.acik?'':' · kapalı')+'</a>').join("")})`,
);

export const YENI = page(
  "Yeni anket",
  `<h1>Yeni anket</h1><form id="f"><label>Soru <input data-testid="anket-soru" size="50"></label>
<div id="s"><input data-testid="anket-secenek" placeholder="Seçenek 1"><br><input data-testid="anket-secenek" placeholder="Seçenek 2"><br></div>
<button type="button" data-testid="secenek-ekle">Seçenek ekle</button> <button data-testid="anket-olustur">Oluştur</button></form><p data-testid="hata-mesaji" class="hata" hidden></p>`,
  `const q=s=>document.querySelector('[data-testid="'+s+'"]');if(!tok())location.href="/giris";
q("secenek-ekle").onclick=()=>{const i=document.createElement("input");i.dataset.testid="anket-secenek";i.placeholder="Seçenek";document.getElementById("s").append(i,document.createElement("br"))};
document.getElementById("f").onsubmit=async e=>{e.preventDefault();const s=[...document.querySelectorAll('[data-testid="anket-secenek"]')].map(x=>x.value.trim()).filter(Boolean);
const r=await api("POST","/api/anketler",{soru:q("anket-soru").value,secenekler:s});if(r.ok)location.href="/anket/"+r.body.id;else{const h=q("hata-mesaji");h.hidden=false;h.textContent=r.body?.hata||"Hata"}}`,
);

export const DETAY = page(
  "Anket",
  `<h1 data-testid="anket-baslik" id="b"></h1><p data-testid="anket-kapali" id="k" hidden>Bu anket kapandı.</p>
<form id="f"><div id="s"></div><button data-testid="oy-gonder" id="g">Oy ver</button></form>
<p data-testid="hata-mesaji" class="hata" hidden></p><h2>Sonuçlar</h2><ul id="r"></ul><button data-testid="anket-kapat" id="kapat" hidden>Anketi kapat</button>`,
  `const q=s=>document.querySelector('[data-testid="'+s+'"]');const aid=location.pathname.split("/").pop();
async function yukle(){const r=await api("GET","/api/anketler/"+aid);if(!r.ok){q("anket-baslik").textContent="Anket bulunamadı";return}const a=r.body;
q("anket-baslik").textContent=a.soru;q("anket-kapali").hidden=a.acik;document.getElementById("g").hidden=!a.acik;document.getElementById("kapat").hidden=!a.acik||!tok();
document.getElementById("s").innerHTML=a.acik?a.secenekler.map(x=>'<label data-testid="oy-secenek"><input type="radio" name="o" value="'+x.id+'"> '+esc(x.metin)+'</label>').join(""):"";
document.getElementById("r").innerHTML=a.secenekler.map(x=>'<li data-testid="sonuc-satiri">'+esc(x.metin)+': '+x.oy+' oy · <span data-testid="sonuc-yuzde">%'+x.yuzde+'</span></li>').join("")}
document.getElementById("f").onsubmit=async e=>{e.preventDefault();const s=document.querySelector('input[name="o"]:checked');const h=q("hata-mesaji");if(!s){h.hidden=false;h.textContent="Bir seçenek seç";return}
const r=await api("POST","/api/anketler/"+aid+"/oy",{secenekId:s.value});if(!r.ok){h.hidden=false;h.textContent=r.body?.hata||"Oy verilemedi"}else h.hidden=true;yukle()};
document.getElementById("kapat").onclick=async()=>{const r=await api("POST","/api/anketler/"+aid+"/kapat");if(!r.ok){const h=q("hata-mesaji");h.hidden=false;h.textContent=r.body?.hata||"Kapatılamadı"}yukle()};yukle();`,
);
