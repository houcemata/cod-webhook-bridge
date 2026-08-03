/* ARCO cart.js - multi-product cart for POSTER and SET products.
   Posters: every 3 posters, cheapest is free.
   Threshold discount applies after poster freebies.
   >= 4 000 DZD -> -500 DZD
   >= 6 000 DZD -> -1 000 DZD
   >= 9 500 DZD -> -2 000 DZD
   >=13 000 DZD -> -3 000 DZD
   Both discounts stack on a mixed cart, but threshold uses the discounted subtotal. */
(function () {
  "use strict";
  const SB_URL = 'https://mpkpehuatqsubohltssi.supabase.co/rest/v1';
  const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1wa3BlaHVhdHFzdWJvaGx0c3NpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5OTc0NzUsImV4cCI6MjA5NTU3MzQ3NX0.v65rahP8E26xAnbcfOHJToKsja6q_A8v3Kxki8LAymk';
  const H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' };
  const KEY = 'arco_cart_v1';

  function read() { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; } }
  function notifyChange() { window.dispatchEvent(new CustomEvent('arco:cartchange', { detail: { count: read().length } })); }
  function write(c) { localStorage.setItem(KEY, JSON.stringify(c)); renderBadge(); notifyChange(); }
  function money(v) { return Number(v || 0).toLocaleString('fr-DZ') + ' DZD'; }
  function esc(v) { return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  
  function normalizeType(item) {
    return String(item?.product_type || item?.type || item?.productType || "").trim().toLowerCase();
  }
  function isPoster(item) {
    const type = normalizeType(item);
    const price = Number(item?.price || 0);
    return type === "poster" || (type !== "set" && price > 0 && price < 2900);
  }
  // ── Poster discount: cheapest of every 3 is free ──
  function computePosterDiscount(cart) {
    const posters = cart.filter(isPoster);
    const prices = posters.map(i => Number(i.price || 0));
    const freeCount = Math.floor(posters.length / 3);
    const sorted = posters.map((_, i) => i).sort((a, b) => prices[a] - prices[b]);
    const freeIdx = new Set(sorted.slice(0, freeCount));
    let discount = 0;
    posters.forEach((_, i) => { if (freeIdx.has(i)) discount += prices[i]; });
    // Map free indices back to full cart indices
    const posterCartIdx = [];
    cart.forEach((it, i) => { if (isPoster(it)) posterCartIdx.push(i); });
    const freeCartIdx = new Set([...freeIdx].map(pi => posterCartIdx[pi]));
    return { posterFreeDiscount: discount, freeCartIdx, freeCount };
  }

  // â”€â”€ Threshold discount on subtotal after poster freebies â”€â”€
  const THRESHOLDS = [
    { min: 13000, off: 3000 },
    { min: 9500,  off: 2000 },
    { min: 6000,  off: 1000 },
    { min: 4000,  off: 500  },
  ];
  function thresholdDiscount(subtotal) {
    for (const t of THRESHOLDS) if (subtotal >= t.min) return t.off;
    return 0;
  }
  function nextThreshold(subtotal) {
    for (let i = THRESHOLDS.length - 1; i >= 0; i--) {
      if (subtotal < THRESHOLDS[i].min) return THRESHOLDS[i];
    }
    return null;
  }

  // ── Full cart totals ──
  function computeTotals(cart) {
    const subtotal = cart.reduce((s, i) => s + Number(i.price || 0), 0);
    const { posterFreeDiscount, freeCartIdx, freeCount } = computePosterDiscount(cart);
    const afterPosters = Math.max(0, subtotal - posterFreeDiscount);
    const thresh = thresholdDiscount(afterPosters);
    const totalDiscount = posterFreeDiscount + thresh;
    return {
      subtotal,
      posterFreeDiscount,
      thresholdDiscount: thresh,
      totalDiscount,
      total: Math.max(0, subtotal - totalDiscount),
      freeCartIdx,
      freeCount,
    };
  }

  // ── Public API ──
  window.ARCOCart = {
    add(item) {
      const cart = read();
      cart.push(item);
      write(cart);
      openAdded(item);
    },
    count() { return read().length; },
    has(slug) {
      const wanted = String(slug || '').trim().toLowerCase();
      if (!wanted) return false;
      return read().some(item => String(item.product_slug || item.slug || '').trim().toLowerCase() === wanted);
    },
    items() { return read(); },
    open: openDrawer,
  };

  function ensureUI() {
    if (document.getElementById('arco-drawer')) return;

    const style = document.createElement('style');
    style.textContent = `
      .arco-ov{position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:70;display:none;backdrop-filter:blur(4px)}
      .arco-ov.show{display:block}
      .arco-drawer{position:fixed;top:0;right:0;bottom:0;width:min(420px,100%);background:#0d0d0d;border-left:1px solid rgba(255,255,255,.1);z-index:80;transform:translateX(100%);transition:transform .25s;display:flex;flex-direction:column;direction:rtl;font-family:'Cairo',sans-serif;color:#fff}
      .arco-drawer.show{transform:translateX(0)}
      .arco-dh{display:flex;align-items:center;justify-content:space-between;padding:18px;border-bottom:1px solid rgba(255,255,255,.08)}
      .arco-dh h3{font:800 1.2rem/1 'Cairo',sans-serif;color:#F5C500}
      .arco-dh button{background:none;border:none;color:#aaa;font-size:24px;cursor:pointer}
      .arco-items{flex:1;overflow-y:auto;padding:14px}
      .arco-ci{display:flex;gap:10px;padding:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;margin-bottom:10px}
      .arco-ci img{width:60px;height:72px;object-fit:cover;border-radius:8px;background:#222;flex-shrink:0}
      .arco-ci .info{flex:1;min-width:0}
      .arco-ci .nm{font:700 .95rem/1.2 'Cairo',sans-serif;margin-bottom:3px}
      .arco-ci .vr{font-size:.78rem;color:#999}
      .arco-ci .pr{font:800 .95rem/1 'Cairo',sans-serif;color:#F5C500;margin-top:5px}
      .arco-ci .pr.free{color:#22c55e}
      .arco-ci .rm{background:none;border:none;color:#e11d48;cursor:pointer;font-size:18px;align-self:flex-start}
      .arco-promo{background:rgba(34,197,94,.12);border:1px solid rgba(34,197,94,.3);color:#5ef0a0;border-radius:12px;padding:12px;text-align:center;font:900 .95rem/1.4 'Changa','Cairo',sans-serif;margin-bottom:10px}
      .arco-promo.near{background:rgba(245,197,0,.1);border-color:rgba(245,197,0,.3);color:#F5C500}
      .arco-promo.thresh{background:rgba(59,130,246,.12);border-color:rgba(59,130,246,.3);color:#93c5fd}
      .arco-empty{text-align:center;color:#888;padding:50px 20px}
      .arco-foot{border-top:1px solid rgba(255,255,255,.08);padding:16px}
      .arco-sum{display:flex;justify-content:space-between;margin-bottom:6px;color:#ccc;font-size:.9rem}
      .arco-sum.tot{color:#fff;font-weight:800;font-size:1.05rem;border-top:1px solid rgba(255,255,255,.08);padding-top:8px;margin-top:8px}
      .arco-sum.disc{color:#22c55e}
      .arco-sum.thresh-disc{color:#93c5fd}
      .arco-cta{width:100%;background:#F5C500;color:#080808;border:none;border-radius:12px;padding:15px;font:800 1rem/1 'Cairo',sans-serif;cursor:pointer;margin-top:12px}
      .arco-browse{width:100%;background:rgba(255,255,255,.06);color:#fff;border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:13px;font:700 .92rem/1 'Cairo',sans-serif;cursor:pointer;margin-top:8px}
      .arco-field{display:grid;gap:6px;margin-bottom:10px}
      .arco-field span{font-size:.82rem;color:#ddd;font-weight:700}
      .arco-field input,.arco-field select{width:100%;background:#111;color:#fff;border:1px solid rgba(255,255,255,.12);border-radius:8px;padding:11px;outline:none;font-family:'Cairo',sans-serif}
      .arco-field input:focus,.arco-field select:focus{border-color:#F5C500}
      .arco-deliv{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px}
      .arco-deliv button{background:#111;border:1px solid rgba(255,255,255,.12);color:#fff;border-radius:8px;padding:11px;cursor:pointer;font-family:'Cairo',sans-serif;font-weight:700}
      .arco-deliv button.active{border-color:#F5C500;background:rgba(245,197,0,.08)}
      .arco-added{position:fixed;bottom:90px;right:20px;z-index:90;background:#0d0d0d;border:1px solid #F5C500;border-radius:14px;padding:14px 16px;color:#fff;font-family:'Cairo',sans-serif;max-width:300px;direction:rtl;transform:translateY(20px);opacity:0;pointer-events:none;transition:.25s;box-shadow:0 12px 30px rgba(0,0,0,.5)}
      .arco-added.show{transform:translateY(0);opacity:1;pointer-events:auto}
      .arco-added .t{font-weight:800;color:#F5C500;margin-bottom:8px}
      .arco-added .btns{display:flex;gap:8px;margin-top:10px}
      .arco-added .btns button{flex:1;border:none;border-radius:8px;padding:9px;font-weight:700;cursor:pointer;font-family:'Cairo',sans-serif;font-size:.82rem}
      .arco-added .b1{background:#F5C500;color:#080808}
      .arco-added .b2{background:rgba(255,255,255,.08);color:#fff}
      .arco-success{position:fixed;inset:0;background:rgba(8,8,8,.97);z-index:100;display:none;place-items:center;text-align:center;padding:24px;direction:rtl;font-family:'Cairo',sans-serif}
      .arco-success.show{display:grid}
      .arco-success-box{max-width:480px;width:100%}
      .arco-success-icon{font-size:52px;margin-bottom:6px}
      .arco-success h2{color:#F5C500;font-size:2rem;margin-bottom:10px}
      .arco-success p{color:#ddd;line-height:1.8}
      .arco-success-upsell{margin-top:20px;background:rgba(245,197,0,.08);border:1px solid rgba(245,197,0,.25);border-radius:16px;padding:16px 18px;text-align:center}
      .arco-success-upsell p{color:#F5C500;font-weight:800;font-size:1rem;margin-bottom:12px}
      .arco-success-browse-btn{display:inline-block;background:#F5C500;color:#080808;border:none;border-radius:10px;padding:12px 24px;font:800 .95rem/1 'Cairo',sans-serif;cursor:pointer;text-decoration:none}
      .arco-success-home-btn{display:inline-block;margin-top:10px;background:rgba(255,255,255,.06);color:#fff;border:1px solid rgba(255,255,255,.12);border-radius:10px;padding:11px 22px;font:700 .88rem/1 'Cairo',sans-serif;cursor:pointer;text-decoration:none}
      .arco-success-copy-toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:#181818;color:#fff;border:1px solid rgba(255,255,255,.12);border-radius:999px;padding:10px 18px;z-index:110;opacity:0;pointer-events:none;transition:.2s}
      .arco-success-copy-toast.show{opacity:1}
      @media(max-width:640px){
        .arco-added{left:14px;right:14px;bottom:84px;max-width:none;padding:18px 20px;border-radius:18px}
        .arco-added .t{font-size:1.05rem;margin-bottom:10px}
        .arco-added .btns button{padding:13px;font-size:.92rem;border-radius:10px}
      }
    `;
    document.head.appendChild(style);

    const ov = document.createElement('div'); ov.className = 'arco-ov'; ov.id = 'arco-ov'; ov.onclick = closeDrawer;
    document.body.appendChild(ov);
    const drawer = document.createElement('div'); drawer.className = 'arco-drawer'; drawer.id = 'arco-drawer';
    document.body.appendChild(drawer);
    const added = document.createElement('div'); added.className = 'arco-added'; added.id = 'arco-added';
    document.body.appendChild(added);
    const success = document.createElement('div'); success.className = 'arco-success'; success.id = 'arco-success';
    document.body.appendChild(success);
    const copyToast = document.createElement('div'); copyToast.className = 'arco-success-copy-toast'; copyToast.id = 'arco-success-copy-toast'; copyToast.textContent = 'تم نسخ الرقم';
    document.body.appendChild(copyToast);
    renderBadge();
  }

  function renderBadge() {
    const n = read().length;
    ['arco-cart-badge', 'sticky-cart-badge'].forEach(id => {
      const b = document.getElementById(id);
      if (!b) return;
      b.textContent = n;
      b.classList.toggle('zero', n === 0);
    });
  }

  function promoLines(cart) {
    const t = computeTotals(cart);
    const lines = [];
    // Poster free promo
    if (t.freeCount > 0) {
      lines.push({ type: 'green', msg: `🎉 عندك ${t.freeCount} لوحة مجانية! وفّرت ${money(t.posterFreeDiscount)}` });
    } else {
      const posters = cart.filter(isPoster);
      const need = (3 - (posters.length % 3)) % 3;
      if (posters.length > 0 && need > 0) {
        lines.push({ type: 'near', msg: `🔥 زيد لوحة و اللوحة الثالثة باااطل!` });
      }
    }
    // Threshold discount
    if (t.thresholdDiscount > 0) {
      lines.push({ type: 'thresh active', msg: `💥 خصم ${money(t.thresholdDiscount)} مطبّق على طلبك!` });
    } else {
      const nx = nextThreshold(Math.max(0, t.subtotal - t.posterFreeDiscount));
      if (nx) {
        const missing = nx.min - Math.max(0, t.subtotal - t.posterFreeDiscount);
        lines.push({ type: 'thresh', msg: `زيد بـ ${money(missing)} فقط وتوفر ${money(nx.off)} خصم!` });
      }
    }
    return lines;
  }

  function openAdded(item) {
    ensureUI();
    const cart = read();
    const t = computeTotals(cart);
    const lines = promoLines(cart);
    const el = document.getElementById('arco-added');
    el.innerHTML = `
      <div class="t">✓ تمت الإضافة إلى السلة</div>
      <div style="font-size:.85rem;color:#ccc">${esc(item.product)} — ${esc(item.variant)}</div>
      ${lines.map(l => `<div style="margin-top:8px;font-weight:700;font-size:.82rem;color:${l.type.includes('thresh') ? '#93c5fd' : l.type === 'green' ? '#5ef0a0' : '#F5C500'}">${l.msg}</div>`).join('')}
      <div class="btns">
        <button class="b1" onclick="ARCOCart.open()">عرض السلة (${cart.length})</button>
        <button class="b2" onclick="ARCOCart_browseMore()">تصفح المزيد</button>
      </div>`;
    el.classList.add('show');
    clearTimeout(window.__arcoAddedT);
    window.__arcoAddedT = setTimeout(() => el.classList.remove('show'), 5000);
  }

  function openDrawer() { ensureUI(); renderDrawer(); validateCart(); document.getElementById('arco-ov').classList.add('show'); document.getElementById('arco-drawer').classList.add('show'); document.getElementById('arco-added').classList.remove('show'); }
  function closeDrawer() { document.getElementById('arco-ov').classList.remove('show'); document.getElementById('arco-drawer').classList.remove('show'); }

  function renderDrawer() {
    const cart = read();
    const d = document.getElementById('arco-drawer');
    if (!cart.length) {
      d.innerHTML = `<div class="arco-dh"><h3>سلة المشتريات</h3><button onclick="document.getElementById('arco-drawer').classList.remove('show');document.getElementById('arco-ov').classList.remove('show')">×</button></div>
        <div class="arco-empty">سلتك فارغة 🛒<br><br>أضف لوحات واستفد من العروض الحصرية!</div>`;
      return;
    }
    const t = computeTotals(cart);
    const lines = promoLines(cart);

    d.innerHTML = `
      <div class="arco-dh"><h3>سلة المشتريات (${cart.length})</h3><button onclick="document.getElementById('arco-drawer').classList.remove('show');document.getElementById('arco-ov').classList.remove('show')">×</button></div>
      <div class="arco-items">
        ${lines.map(l => `<div class="arco-promo ${l.type}">${l.msg}</div>`).join('')}
        ${cart.map((it, i) => {
          const free = t.freeCartIdx.has(i);
          return `<div class="arco-ci">
            ${it.image ? `<img src="${esc(it.image)}" alt="">` : '<div style="width:60px;height:72px;background:#222;border-radius:8px"></div>'}
            <div class="info">
              <div class="nm">${esc(it.product)}</div>
              <div class="vr">${esc(it.variant)}</div>
              <div class="pr ${free ? 'free' : ''}">${free ? 'مجانية 🎁' : money(it.price)}</div>
            </div>
            <button class="rm" onclick="ARCOCart_remove(${i})">🗑</button>
          </div>`;
        }).join('')}
      </div>
      <div class="arco-foot">
        <div class="arco-sum"><span>المجموع الفرعي</span><span>${money(t.subtotal)}</span></div>
        ${t.posterFreeDiscount > 0 ? `<div class="arco-sum disc"><span>لوحات مجانية 🎁</span><span>− ${money(t.posterFreeDiscount)}</span></div>` : ''}
        ${t.thresholdDiscount > 0 ? `<div class="arco-sum thresh-disc"><span>خصم الطلب 💥</span><span>− ${money(t.thresholdDiscount)}</span></div>` : ''}
        <div class="arco-sum tot"><span>المجموع (بدون توصيل)</span><span>${money(t.total)}</span></div>
        <button class="arco-cta" onclick="ARCOCart_checkout()">إتمام الطلب</button>
        <button class="arco-browse" onclick="ARCOCart_browseMore()">تصفح المزيد</button>
      </div>`;
  }

  window.ARCOCart_remove = function (i) { const c = read(); c.splice(i, 1); write(c); renderDrawer(); };

  window.ARCOCart_browseMore = function () {
    document.getElementById('arco-added').classList.remove('show');
    closeDrawer();
    let last = '';
    try { last = localStorage.getItem('arco_last_collection') || ''; } catch {}
    location.href = last ? `/c/${encodeURIComponent(last)}` : '/';
  };

  // ── Wilaya/commune data ──
  const WILAYAS = [['01','Adrar'],['02','Chlef'],['03','Laghouat'],['04','Oum El Bouaghi'],['05','Batna'],['06','Bejaia'],['07','Biskra'],['08','Bechar'],['09','Blida'],['10','Bouira'],['11','Tamanrasset'],['12','Tebessa'],['13','Tlemcen'],['14','Tiaret'],['15','Tizi Ouzou'],['16','Algiers'],['17','Djelfa'],['18','Jijel'],['19','Setif'],['20','Saida'],['21','Skikda'],['22','Sidi Bel Abbes'],['23','Annaba'],['24','Guelma'],['25','Constantine'],['26','Medea'],['27','Mostaganem'],['28',"M'Sila"],['29','Mascara'],['30','Ouargla'],['31','Oran'],['32','El Bayadh'],['33','Illizi'],['34','Bordj Bou Arreridj'],['35','Boumerdes'],['36','El Tarf'],['37','Tindouf'],['38','Tissemsilt'],['39','El Oued'],['40','Khenchela'],['41','Souk Ahras'],['42','Tipaza'],['43','Mila'],['44','Ain Defla'],['45','Naama'],['46','Ain Temouchent'],['47','Ghardaia'],['48','Relizane'],['49','Timimoun'],['50','Bordj Badji Mokhtar'],['51','Ouled Djellal'],['52','Beni Abbes'],['53','In Salah'],['54','In Guezzam'],['55','Touggourt'],['56','Djanet'],['57',"El M'Ghair"],['58','El Menia']];
  const WILAYA_DATA={"01 - Adrar":["Adrar","Akabli","Aougrout","Aoulef","Bordj Badji Mokhtar","Bouda","Charouine","Deldoul","Fenoughil","In Zghmir","Ksar Kaddour","Metarfa","Ouled Ahmed Tammi","Ouled Aissa","Ouled Said","Reggane","Sali","Sbaa","Talmine","Tamentit","Tamest","Timiaouine","Timimoun","Timokten","Tinerkouk","Tit","Tsabit","Zaouiet Kounta"],"02 - Chlef":["Abou El Hassen","Ain Merane","Benairia","Beni Bouateb","Beni Haoua","Beni Rached","Boukadir","Bouzghaia","Breira","Chettia","Chlef","Dahra","El Hadjadj","El Karimia","El Marsa","Harchoun","Herenfa","Labiod Medjadja","Moussadek","Oued Fodda","Oued Goussine","Oued Sly","Ouled Abbes","Ouled Ben Abdelkader","Ouled Fares","Oum Drou","Sendjas","Sidi Abderrahmane","Sidi Akacha","Sobha","Tadjna","Talassa","Taougrite","Tenes","Zeboudja"],"03 - Laghouat":["Aflou","Ain Mahdi","Ain Sidi Ali","Beidha","Benacer Ben Chohra","Brida","El Assafia","El Ghicha","El Haouaita","El Kheneg","Gueltat Sidi Saad","Hadj Mechri","Hassi Delaa","Hassi R'Mel","Ksar El Hirane","Laghouat","Oued M'Zi","Oued Morra","Sebgag","Sidi Bouzid","Sidi Makhlouf","Tadjmout","Tadjrouna","Taouiala"],"04 - Oum El Bouaghi":["Ain Babouche","Ain Beida","Ain Diss","Ain Fekroune","Ain Kercha","Ain M'lila","Ain Zitoun","Behir Chergui","Berriche","Bir Chouhada","Dhala","El Amiria","El Belala","El Djazia","El Fedjoudj Boughrara Saoudi","El Harmilia","Fkirina","Hanchir Toumghani","Ksar Sbahi","Meskiana","Oued Nini","Ouled Gacem","Ouled Hamla","Ouled Zouai","Oum El Bouaghi","Rahia","Sigus","Souk Naamane","Zorg"],"05 - Batna":["Ain Djasser","Ain Touta","Ain Yagout","Arris","Barika","Batna","Beni Foudhala El Hakania","Bitam","Boulhilat","Boumagueur","Boumia","Bouzina","Chemora","Chir","Djerma","Djezzar","El Hassi","El Madher","Fesdis","Foum Toub","Ghassira","Gosbat","Guigba","Hidoussa","Ichmoul","Inoughissen","Kimmel","Ksar Belezma","Larbaa","Lazrou","Lemsane","M'doukel","Maafa","Menaa","Merouana","Metkaouak","N Gaous","Oued Chaaba","Oued El Ma","Oued Taga","Ouled Ammar","Ouled Aouf","Ouled Fadel","Ouled Selam","Ouled Si Slimane","Ouyoun El Assafir","Rahbat","Ras El Aioun","Sefiane","Seggana","Seriana","Talkhamt","Taxlent","Tazoult","Teniet El Abed","Tighanimine","Tigherghar","Tilatou","Timgad","Tkout","Zanat El Beida"],"06 - Bejaia":["Adekar","Ait Djellil","Ait R'zine","Ait Smail","Akbou","Akfadou","Amalou","Amizour","Aokas","Barbacha","Bejaia","Beni Ksila","Beni Melikeche","Benimaouch","Boudjellil","Bouhamza","Boukhelifa","Chelata","Chemini","Darguina","Draa Kaid","El Kseur","Feraoun","Ifelain Ilmathen","Ighil Ali","Ighram","Kendira","Kherrata","Leflaye","M'cisna","Melbou","Oued Ghir","Ouzallaguen","Seddouk","Semaoun","Sidi Aich","Sidi Ayad","Souk El Thenine","Souk Oufella","Tala Hamza","Tamokra","Tamridjet","Taourirt Ighil","Taskriout","Tazmalt","Thinabdher","Tibane","Tichi","Tifra","Timzrit","Tizi N'berber","Toudja"],"07 - Biskra":["Ain Naga","Ain Zaatout","Besbes","Biskra","Bordj Ben Azzouz","Bouchagroun","Branis","Chetma","Djemorah","Doucen","Ech Chaiba","El Feidh","El Ghrous","El Hadjab","El Haouch","El Kantara","El Outaya","Foughala","Khanguet Sidinadji","Lichana","Lioua","M'lili","M'ziraa","Mchouneche","Mekhadma","Ouled Djellal","Oumache","Ourlal","Ras El Miaad","Sidi Khaled","Sidi Okba","Tolga","Zeribet El Oued"],"08 - Bechar":["Abadla","Bechar","Beni Abbes","Beni Ikhlef","Beni Ounif","Boukais","El Ouata","Erg Ferradj","Igli","Kenedsa","Kerzaz","Ksabi","Lahmar","Mechraa Houari Boumedienne","Meridja","Mogheul","Ouled Khoudir","Tabalbala","Taghit","Tamtert","Timoudi"],"09 - Blida":["Ain Romana","Beni Mered","Beni Tamou","BenKhlil","Blida","Bouarfa","Boufarik","Bougara","Bouinan","Chebli","Chiffa","Chrea","Djebabra","El Affroun","Guerrouaou","Hammam Melouane","Larbaa","Meftah","Mouzaia","Oued Djer","Oued El Alleug","Ouled Selama","Ouled Yaich","Souhane","Soumaa"],"10 - Bouira":["Aghbalou","Ahl El Ksar","Ain Bessem","Ain El Hadjar","Ain Laloui","Ain Turk","Ait Laaziz","Aomar","Ath Mansour","Bechloul","Bir Ghbalou","Bordj Oukhriss","Bouderbala","Bouira","Boukram","Chorfa","Dechmia","Dirah","Djebahia","El Adjiba","El Asnam","El Hachimia","El Hakimia","El Khebouzia","El Mokrani","Guerrouma","Hadjera Zerga","Haizer","Hanif","Kadiria","Lakhdaria","Maala","Maamora","Mchedallah","Mezdour","Oued El Berdi","Ouled Rached","Raouraoua","Ridane","Saharidj","Souk El Khemis","Sour El Ghozlane","Taghzout","Taguedit","Zbarbar"],"11 - Tamanrasset":["Abalessa","Foggaret Ezzaouia","Idles","In Amguel","In Ghar","In Guezzam","In Salah","Tamanrasset","Tazouk","Tinzaouatine"],"12 - Tebessa":["Ain Zerga","Bedjene","Bekkaria","Bir Dheb","Bir El Ater","Bir El Mokadem","Boukhadra","Boulhaf Dyr","Cheria","El Aouinet","El Kouif","El Ma El Biodh","El Mazeraa","El Meridj","El Ogla","Ferkane","Gorriguer","Hammamet","Lahouidjbet","Morsot","Negrine","Ouenza","Oum Ali","Sef saf El Ouesra","Stah Guentis","Tebessa","Tlidjene"],"13 - Tlemcen":["Ain Fetah","Ain Fezza","Ain Ghoraba","Ain Kebira","Ain Nehala","Ain Tallout","Ain Youcef","Amieur","Azails","Bab El Assa","Beni Bahdel","Beni Boussaid","Beni Mester","Beni Ouarsous","Beni Semiel","Beni Snous","Bensekrane","Bouhlou","Chetouane","Dar Yaghmouracene","Djebala","El Aricha","El Bouihi","El Fehoul","El Gor","Fellaoucene","Ghazaouet","Hammam Boughrara","Hennaya","Honaine","Maghnia","Mansourah","Marsa Ben Mhidi","Msirda Fouaga","Nedroma","Oued Chouly","Ouled Mimoun","Ouled Riyah","Remchi","Sabra","Sebbaa Chioukh","Sebdou","Sidi Abdelli","Sidi Djillali","Sidi Medjahed","Souahlia","Souani","Souk El Khemis","Souk Thlata","Terni Beni Hediel","Tianet","Tlemcen","Zenata"],"14 - Tiaret":["Ain Bouchekif","Ain Deheb","Ain El Hadid","Ain Kermes","Ain Zarit","Bougara","Chehaima","Dahmouni","Djillali Ben Amar","Faidja","Frenda","Guertoufa","Hamadia","Ksar Chellala","Madna","Mahdia","Mechraa Safa","Medrissa","Medroussa","Meghila","Mellakou","Nadorah","Naima","Oued Lilli","Ouled Djerad","Rahouia","Rechaiga","Sebaine","Sebt","Serghine","Sidi Abdelghani","Sidi Abderrahmane","Sidi Ali Mellal","Sidi Bakhti","Sidi Hosni","Sougueur","Tagdemt","Takhemaret","Tiaret","Tidda","Tousnina","Zmalet El Emir Abdelkade"],"15 - Tizi Ouzou":["Abi Youcef","Aghrib","Agouni Gueghrane","Ain El Hammam","Ain Zaouia","Ait Aggouacha","Ait Aissa Mimoun","Ait Bouadou","Ait Boumehdi","Ait Chaffaa","Ait Khelil","Ait Mahmoud","Ait Oumalou","Ait Toudert","Ait Yahia","Ait Yahia Moussa","Akbil","Akerrou","Assi Youcef","Azazga","Azzefoun","Beni Aissi","Beni Douala","Beni Yenni","Beni Ziki","Beni Zmenzer","Boghni","Boudjima","Bounouh","Bouzguene","Draa Ben Khedda","Draa El Mizan","Freha","Frikat","Iboudraren","Idjeur","Iferhounene","Ifigha","Iflissen","Illilten","Iloula Oumalou","Imsouhal","Irdjen","Larba Nath Irathen","Maatkas","Makouda","Mechtrass","Mekla","Mizrana","Mkira","Ouacif","Ouadhia","Ouaguenoun","Sidi Naamane","Souamaa","Souk El Thenine","Tadmait","Tigzirt","Timizart","Tirmitine","Tizi Ghenif","Tizi Nthlata","Tizi Ouzou","Tizi Rached","Yakourene","Yatafen","Zekri"],"16 - Algiers":["Ain Benian","Ain Taya","Alger Centre","Bab El Oued","Bab Ezzouar","Baba Hesen","Bachedjerah","Bains Romains","Baraki","Ben Aknoun","Beni Messous","Bir Mourad Rais","Bir Touta","Birkhadem","Bologhine Ibnou Ziri","Bordj El Bahri","Bordj El Kiffan","Bourouba","Bouzareah","Casbah","Cheraga","Dar El Beida","Dely Ibrahim","Djasr Kasentina","Douira","Draria","El Achour","El Biar","El Harrach","El Madania","El Magharia","El Mouradia","Herraoua","Hussein Dey","Hydra","Kheraisia","Kouba","Les Eucalyptus","Maalma","Marsa","Mohamed Belouzdad","Mohammadia","Oued Koriche","Oued Smar","Ouled Chebel","Ouled Fayet","Rahmania","Rais Hamidou","Reghaia","Rouiba","Sehaoula","Setaouali","Sidi M'hamed","Sidi Moussa","Souidania","Tessala el Merdja","Zeralda"],"17 - Djelfa":["Ain Chouhada","Ain El Ibel","Ain Fekka","Ain Maabed","Ain Oussera","Amourah","Benhar","Beni Yacoub","Birine","Bouira Lahdeb","Charef","Dar Chouikh","Deldoul","Djelfa","Douis","El Guedid","El Idrissia","El Khemis","Feidh El Botma","Guernini","Guettara","Had Sahary","Hassi Bahbah","Hassi El Euch","Hassi Fedoul","M'Liliha","Messaad","Moudjebara","Oum Laadham","Sed Rahal","Selmana","Sidi Baizid","Sidi Ladjel","Tadmit","Zaafrane","Zaccar"],"18 - Jijel":["Bordj T'her","Boudria Beni Yadjis","Bouraoui Belhadef","Boussif Ouled Askeur","Chahna","Chekfa","Djemaa Beni Habibi","Djmila","El Ancer","El Aouana","El Kennar Nouchfi","El Milia","Emir Abdelkader","Erraguene","Ghebala","Jijel","Kaous","Kemir Oued Adjoul","Ouadjana","Ouled Rabah","Ouled Yahia Khadrouch","Selma Benziada","Settara","Sidi Abdelaziz","Sidi Maarouf","Taher","Texena","Ziamma Mansouriah"],"19 - Setif":["Ain Abessa","Ain Arnat","Ain Azal","Ain El Kebira","Ain Lahdjar","Ain Legraj","Ain Oulmane","Ain Roua","Ain Sebt","Ait Naoual Mezada","Ait Tizi","Amoucha","Babor","Bazer Sakhra","Beidha Bordj","Belaa","Beni Aziz","Beni Chebana","Beni Fouda","Beni Mouhli","Beni Ouartilane","Beni Oussine","Bir El Arch","Bir Haddada","Bouandas","Bougaa","Bousselam","Boutaleb","Dehamcha","Djemila","Draa Kebila","El Eulma","El Ouldja","El Ouricia","Guellal","Guelta Zerka","Guenzet","Guidjel","Hamma","Hammam Essokhna","Hammam Guergour","Harbil","Ksar El Abtal","Maaouia","Maouklane","Mezloug","Oued El Barad","Ouled Addouane","Ouled Sabor","Ouled Sidi Ahmed","Ouled Tebben","Rosfa","Salah Bey","Serdj El Ghoul","Setif","Tachouda","Talaifacene","Taya","Tella","Tizi Nbechar"],"20 - Saida":["Ain El Hadjar","Ain Sekhouna","Ain Soltane","Doui Thabet","El Hassasna","Hounet","Maamora","Moulay Larbi","Ouled Brahim","Ouled Khaled","Saida","Sidi Ahmed","Sidi Amar","Sidi Boubekeur","Tircine","Youb"],"21 - Skikda":["Ain Bouziane","Ain Cherchar","Ain Kechra","Ain Zouit","Azzaba","Bein El Ouiden","Bekkouche Lakhdar","Ben Azzouz","Beni Bachir","Beni Oulbane","Beni Zid","Bouchtata","Cheraia","Collo","Djendel","El Ghedir","El Hadeaik","El Harrouch","El Marsa","Emdjez Edchich","Es Sebt","Filfila","Hamadi Krouma","Kanoua","Kerkera","Kheneg Mayoum","Oued Zehour","Ouldja Boulbalout","Ouled Attia","Ouled Hebaba","Oum Toub","Ramdane Djamel","Salah Bouchaour","Sidi Mezghiche","Skikda","Tamalous","Zerdazas","Zitouna"],"22 - Sidi Bel Abbes":["Ain Adden","Ain El Berd","Ain Kada","Ain Thrid","Ain Tindamine","Amarnas","Badredine El Mokrani","Belarbi","Ben Badis","Benachiba Chelia","Bir El Hammam","Boudjebaa El Bordj","Boukhanafis","Chetouane Belaila","Dhaya","El Hacaiba","Hassi Dahou","Hassi Zehana","Lamtar","Makedra","Marhoum","Mcid","Merine","Mezaourou","Mostefa Ben Brahim","Moulay Slissen","Oued Sbaa","Oued Sefioun","Oued Taourira","Ras El Ma","Redjem Demouche","Sehala Thaoura","Sfissef","Sidi Ali Benyoub","Sidi Ali Boussidi","Sidi Bel Abbes","Sidi Brahim","Sidi Chaib","Sidi Dahou","Sidi Hamadouche","Sidi Khaled","Sidi Lahcene","Sidi Yacoub","Tabia","Tafissour","Taoudmout","Teghalimet","Telagh","Tenira","Tessala","Tilmouni","Zerouala"],"23 - Annaba":["Ain Berda","Annaba","Berrahel","Chetaibi","Cheurfa","El Bouni","El Hadjar","Eulma","Oued El Aneb","Seraidi","Sidi Amer","Treat"],"24 - Guelma":["Ain Ben Beida","Ain Larbi","Ain Makhlouf","Ain Reggada","Ain Sandel","Belkhir","Ben Djarah","Beni Mezline","Bordj Sabat","Bou Hachana","Bou Hamdane","Bouati Mahmoud","Bouchegouf","Bouhamra Ahmed","Dahouara","Djeballah Khemissi","El Fedjoudj","Guelaat Bou Sbaa","Guelma","Hammam Maskhoutine","Hamman Nbail","Heliopolis","Houari Boumediene","Khezara","Medjez Amar","Medjez Sfa","Nechmaya","Oued Cheham","Oued Fragha","Oued Zenati","Ras El Agba","Roknia","Salaoua Announa","Tamlouka"],"25 - Constantine":["Ain Abid","Ain Smara","Beni Hamiden","Constantine","Didouche Mourad","El Khroub","Hamma Bouziane","Ibn Badis","Ibn Ziad","Mesaoud Boujeriou","Ouled Rahmoune","Zighoud Youcef"],"26 - Medea":["Ain Boucif","Ain Ouksir","Aissaouia","Aziz","Baata","Benchicao","Beni Slimane","Berrouaghia","Bir Ben Laabed","Boghar","Bouaiche","Bouaichoune","Bouchrahil","Boughezoul","Bouskene","Chahbounia","Chelalet El Adhaoura","Cheniguel","Derrag","Deux Bassins","Djouab","Draa Essamar","El Azizia","El Guelbelkebir","El Hamdania","El Omaria","El Ouinet","Hannacha","Kef Lakhdar","Khams Djouamaa","Ksar El Boukhari","Medea","Medjebar","Meftaha","Meghraoua","Mezerena","Mihoub","Ouamri","Oued Harbil","Ouled Antar","Ouled Bouachra","Ouled Brahim","Ouled Deide","Ouled Hellal","Ouled Maaref","Oum El Djalil","Ouzera","Rebaia","Saneg","Sedraia","Seghouane","Si Mahdjoub","Sidi Damed","Sidi Errabia","Sidi Naamane","Sidi Zahar","Sidi Ziane","Souagui","Tablat","Tafraout","Tamesguida","Tizi Mahdi","Tlatet Eddouair","Zoubiria"],"27 - Mostaganem":["Abdelmalek Ramdane","Achaacha","Ain Boudinar","Ain Nouissy","Ain Sidi Cherif","Ain Tadles","Bouguirat","El Hassiane","Fornaka","Hadjadj","Hassi Mameche","Khadra","Kheiredine","Mansourah","Mesra","Mezghrane","Mostaganem","Nekmaria","Oued El Kheir","Ouled Boughalem","Ouled Maallah","Safsaf","Sayada","Sidi Ali","Sidi Bellater","Sidi Lakhdar","Sirat","Souaflia","Sour","Stidia","Tazgait","Touahria"],"28 - M'Sila":["Ain El Hadjel","Ain El Melh","Ain Errich","Ain Fares","Ain Khadra","Belaiba","Ben Srour","Beni Ilmane","Benzouh","Berhoum","Bir Foda","Bou Saada","Bouti Sayah","Chellal","Dehahna","Djebel Messaad","El Hamel","El Houamed","Hammam Dhalaa","Khettouti Sed Djir","Khoubana","M'cif","M'sila","Maadid","Maarif","Magra","Medjedel","Mtarfa","Ouanougha","Oued Chair","Ouled Addi Guebala","Ouled Atia","Ouled Derradj","Ouled Madhi","Ouled Mansour","Ouled Sidi Brahim","Ouled Slimane","Oultene","Sidi Aissa","Sidi Ameur","Sidi Hadjeres","Sidi M'Hamed","Slim","Souamaa","Tamsa","Tarmount","Zarzour"],"29 - Mascara":["Ain Fares","Ain Fekan","Ain Ferah","Ain Frass","Alaimia","Aouf","Benian","Bou Hanifia","Bou Henni","Chorfa","El Bordj","El Gaada","El Ghomri","El Hachem","El Keurt","El Mamounia","El Menaouer","Ferraguig","Froha","Gharrous","Gherdjoum","Ghriss","Guettena","Hacine","Khalouia","Makdha","Maoussa","Mascara","Matemore","Moctadouz","Mohammadia","Nesmot","Oggaz","Oued El Abtal","Oued Taria","Ras Ain Amirouche","Sedjerara","Sehailia","Sidi Abdeldjebar","Sidi Abdelmoumene","Sidi Boussaid","Sidi Kada","Sig","Teghennif","Tizi","Zahana","Zelmata"],"30 - Ouargla":["Ain Beida","Balidat Ameur","Benaceur","El Allia","El Borma","El Hadjira","Hassi Ben Abdellah","Hassi Messaoud","Megarine","Mnaguer","Nezla","Ngoussa","Ouargla","Rouissat","Sidi Khouiled","Sidi Slimane","Taibet","Tamacine","Tebesbest","Touggourt","Zaouia El Abidia"],"31 - Oran":["Ain Biya","Ain Kerma","Ain Turk","Arzew","Ben Freha","Bethioua","Bir El Djir","Boufatis","Bousfer","Boutlelis","El Ancar","El Braya","El Karma","Es Senia","Gdyel","Hassi Ben Okba","Hassi Bounif","Hassi Mefsoukh","Marsat El Hadjadj","Mers El Kebir","Messerghin","Oran","Oued Tlelat","Sidi Ben Yebka","Sidi Chami","Tafraoui"],"32 - El Bayadh":["Ain El Orak","Arbaouat","Boualem","Bougtoub","Boussemghoun","Brezina","Cheguig","Chellala","El Abiodh Sidi Cheikh","El Bayadh","El Bnoud","El Kheither","El Mehara","Ghassoul","Kef El Ahmar","Krakda","Rogassa","Sidi Ameur","Sidi Slimane","Sidi Tifour","Stitten","Tousmouline"],"33 - Illizi":["Bordj El Haouasse","Bordj Omar Driss","Debdeb","Djanet","Illizi","In Amenas"],"34 - Bordj Bou Arreridj":["Ain Taghrout","Ain Tesra","Belimour","Ben Daoud","Bir Kasdali","Bordj Bou Arreridj","Bordj Ghdir","Bordj Zemoura","Colla","Djaafra","El Ach","El Achir","El Anseur","El Hamadia","El Main","El Mhir","Ghilassa","Haraza","Hasnaoua","Khelil","Ksour","Mansoura","Medjana","Ouled Brahem","Ouled Dahmane","Ouled Sidi Brahim","Rabta","Ras El Oued","Sidi Embarek","Tafreg","Taglait","Teniet En Nasr","Tesmart","Tixter"],"35 - Boumerdes":["Afir","Ammal","Baghlia","Ben Choud","Beni Amrane","Bordj Menaiel","Boudouaou","Boudouaou El Bahri","Boumerdes","Bouzegza Keddara","Chabet El Ameur","Corso","Dellys","Djinet","El Kharrouba","Hammedi","Isser","Khemis El Khechna","Laghata","Larbatache","Naciria","Ouled Aissa","Ouled Hedadj","Ouled Moussa","Si Mustapha","Sidi Daoud","Souk El Had","Taourga","Thenia","Tidjelabine","Timezrit","Zemmouri"],"36 - El Tarf":["Ain El Assel","Ain Kerma","Asfour","Ben M Hidi","Berrihane","Besbes","Bougous","Bouhadjar","Bouteldja","Chebaita Mokhtar","Chefia","Chihani","Drean","Echatt","El Aioun","El Kala","El Tarf","Hammam Beni Salah","Lac Des Oiseaux","Oued Zitoun","Raml Souk","Souarekh","Zerizer","Zitouna"],"37 - Tindouf":["Oum El Assel","Tindouf"],"38 - Tissemsilt":["Ammari","Beni Chaib","Beni Lahcene","Bordj Bou Naama","Bordj El Emir Abdelkader","Boucaid","Khemisti","Larbaa","Lardjem","Layoune","Lazharia","Maasem","Melaab","Ouled Bessem","Sidi Abed","Sidi Boutouchent","Sidi Lantri","Sidi Slimane","Tamalaht","Theniet El Had","Tissemsilt","Youssoufia"],"39 - El Oued":["Bayadha","Beni Guecha","Debila","Djamaa","Douar El Ma","El Mghair","El Ogla","El Oued","Guemar","Hamraia","Hassani Abdelkrim","Hassi Khelifa","Kouinine","Magrane","Mih Ouansa","Mrara","Nakhla","Oued El Alenda","Oum Touyour","Ourmas","Reguiba","Robbah","Sidi Amrane","Sidi Aoun","Sidi Khellil","Still","Taghzout","Taleb Larbi","Tendla","Trifaoui"],"40 - Khenchela":["Ain Touila","Babar","Baghai","Bouhmama","Chelia","Cherchar","Djellal","El Hamma","El Mahmal","El Oueldja","Ensigha","Kais","Khenchela","Khirane","Msara","Mtoussa","Ouled Rechache","Remila","Tamza","Taouzianat","Yabous"],"41 - Souk Ahras":["Ain Soltane","Ain Zana","Bir Bouhouche","Drea","Haddada","Hanancha","Khedara","Khemissa","M'daourouche","Mechroha","Merahna","Oued Keberit","Ouled Driss","Ouled Moumen","Oum El Adhaim","Quillen","Ragouba","Safel El Ouiden","Sedrata","Sidi Fredj","Souk Ahras","Taoura","Terraguelt","Tiffech","Zaarouria","Zouabi"],"42 - Tipaza":["Aghabal","Ahmer El Ain","Ain Tagourait","Attatba","Beni Milleuk","Bou Haroun","Bou Ismail","Bourkika","Chaiba","Cherchell","Damous","Douaouda","Fouka","Gouraya","Hadjerat Ennous","Hadjout","Khemisti","Kolea","Larhat","Menaceur","Messelmoun","Meurad","Nodor","Sidi Amar","Sidi Ghiles","Sidi Rached","Sidi Semiane","Tipaza"],"43 - Mila":["Ahmed Rachedi","Ain Beida Harriche","Ain Mellouk","Ain Tine","Amira Arras","Benyahia Abderrahmane","Bouhatem","Chelghoum Laid","Chigara","Derradji Bousselah","El Mechira","Elayadi Barbes","Ferdjioua","Grarem Gouga","Hamala","Mila","Minar Zarza","Oued Athmenia","Oued Endja","Oued Seguen","Ouled Khalouf","Rouached","Sidi Khelifa","Sidi Merouane","Tadjenanet","Tassadane Haddada","Telerghma","Terrai Bainen","Tessala Lamatai","Tiberguent","Yahia Beniguecha","Zeghaia"],"44 - Ain Defla":["Ain Benian","Ain Bouyahia","Ain Defla","Ain Lechiakh","Ain Soltane","Ain Torki","Arib","Barbouche","Bathia","Belaas","Ben Allal","Bir Ouled Khelifa","Bordj Emir Khaled","Boumedfaa","Bourached","Djelida","Djemaa Ouled Chikh","Djendel","El Abadia","El Amra","El Attaf","El Hassania","El Maine","Hammam Righa","Hoceinia","Khemis Miliana","Mekhatria","Miliana","Oued Chorfa","Oued Djemaa","Rouina","Sidi Lakhdar","Tachta Zegagha","Tarik Ibn Ziad","Tiberkanine","Zeddine"],"45 - Naama":["Ain Ben Khelil","Ain Sefra","Assela","Djeniane Bourzeg","El Biod","Kasdir","Makman Ben Amer","Mechria","Moghrar","Naama","Sfissifa","Tiout"],"46 - Ain Temouchent":["Aghlal","Ain El Arbaa","Ain Kihal","Ain Temouchent","Ain Tolba","Aoubellil","Beni Saf","Bou Zedjar","Chaabet El Ham","Chentouf","El Amria","El Emir Abdelkader","El Malah","El Messaid","Hammam Bouhadjar","Hassasna","Hassi El Ghella","Oued Berkeche","Oued Sabah","Ouled Boudjemaa","Ouled Kihal","Oulhaca El Gheraba","Sidi Ben Adda","Sidi Boumediene","Sidi Ouriache","Sidi Safi","Tamzoura","Terga"],"47 - Ghardaia":["Berriane","Bounoura","Dhayet Bendhahoua","El Atteuf","El Guerrara","El Meniaa","Ghardaia","Hassi Fehal","Hassi Gara","Mansoura","Metlili","Sebseb","Zelfana"],"48 - Relizane":["Ain Rahma","Ain Tarek","Ammi Moussa","Belaassel Bouzagza","Bendaoud","Beni Dergoun","Beni Zentis","Dar Ben Abdellah","Djidiouia","El Guettar","El Hamadna","El Hassi","El Matmar","El Ouldja","Had Echkalla","Hamri","Kalaa","Lahlef","Mazouna","Mediouna","Mendes","Merdja Sidi Abed","Ouarizane","Oued El Djemaa","Oued Essalem","Oued Rhiou","Ouled Aiche","Ouled Sidi Mihoub","Ramka","Relizane","Sidi Khettab","Sidi Lazreg","Sidi M'hamed Benali","Sidi M'hamed Benaouda","Sidi Saada","Souk El Had","Yellel","Zemmoura"],"49 - Timimoun":["Aougrout","Charouine","Deldoul","Ksar Kaddour","Metarfa","Ouled Aissa","Ouled Said","Talmine","Timimoun","Tinerkouk"],"50 - Bordj Baji Mokhtar":["Bordj Badji Mokhtar","Timiaouine"],"51 - Ouled Djellal":["Besbes","Chaiba","Doucen","Ouled Djellal","Ras El Miad","Sidi Khaled"],"52 - Beni Abbes":["Beni-Abbes","Beni-Ikhlef","El Ouata","Igli","Kerzaz","Ksabi","Ouled-Khodeir","Tamtert","Timoudi"],"53 - In Salah":["Ain Salah","Foggaret Ezzoua","Inghar"],"54 - In Guezzam":["Ain Guezzam","Tin Zouatine"],"55 - Touggourt":["Benaceur","Blidet Amor","El Alia","El-Hadjira","M'naguer","Megarine","Nezla","Sidi Slimane","Taibet","Tebesbest","Temacine","Touggourt","Zaouia El Abidia"],"56 - Djanet":["Bordj El Haouass","Djanet"],"57 - El M'Ghair":["Djamaa","El-M'ghaier","M'rara","Oum Touyour","Sidi Amrane","Sidi Khelil","Still","Tenedla"],"58 - El Menia":["El Meniaa","Hassi Fehal","Hassi Gara"]};
  const WILAYA_COMMUNES = Object.fromEntries(Object.entries(WILAYA_DATA).map(([key, value]) => [key.slice(0, 2), value]));
  let coShipping = { home_delivery: 0, stop_desk: 0 }, coDelivery = 'home', coDesks = null;

  window.ARCOCart_checkout = function () {
    const cart = read(); if (!cart.length) return;
    const t = computeTotals(cart);
    const d = document.getElementById('arco-drawer');
    d.innerHTML = `
      <div class="arco-dh"><h3>إتمام الطلب</h3><button onclick="ARCOCart.open()">→</button></div>
      <div class="arco-items">
        ${t.posterFreeDiscount > 0 ? `<div class="arco-promo">🎁 لوحات مجانية: − ${money(t.posterFreeDiscount)}</div>` : ''}
        ${t.thresholdDiscount > 0 ? `<div class="arco-promo thresh active">💥 خصم الطلب: − ${money(t.thresholdDiscount)}</div>` : ''}
        <div class="arco-field"><span>الاسم الكامل</span><input id="co-name" autocomplete="name"></div>
        <div class="arco-field"><span>رقم الهاتف</span><input id="co-phone" inputmode="tel" placeholder="05XXXXXXXX"></div>
        <div class="arco-field"><span>الولاية</span><select id="co-wilaya" onchange="ARCOCart_wilaya()"><option value="">اختر الولاية</option>${WILAYAS.map(w => `<option value="${w[0]}|${w[1]}">${w[0]} - ${w[1]}</option>`).join('')}</select></div>
        <div class="arco-deliv">
          <button id="co-home" class="active" onclick="ARCOCart_deliv('home')">إلى المنزل<br><small id="co-home-p">—</small></button>
          <button id="co-pickup" onclick="ARCOCart_deliv('pickup')">مكتب التوصيل<br><small id="co-pickup-p">—</small></button>
        </div>
        <div class="arco-field" id="co-commune-wrap"><span>البلدية</span><select id="co-commune"><option value="">اختر البلدية</option></select></div>
        <div class="arco-field" id="co-desk-wrap" style="display:none"><span>نقطة الاستلام</span><select id="co-desk" onchange="window.__coDesk=this.value"><option value="">اختر النقطة</option></select></div>
      </div>
      <div class="arco-foot">
        <div class="arco-sum"><span>المنتجات</span><span>${money(t.total)}</span></div>
        <div class="arco-sum"><span>التوصيل</span><span id="co-ship">0 DZD</span></div>
        <div class="arco-sum tot"><span>المجموع</span><span id="co-total">${money(t.total)}</span></div>
        <button class="arco-cta" id="co-submit" onclick="ARCOCart_submit()">تأكيد الطلب (الدفع عند الاستلام)</button>
      </div>`;
    coDelivery = 'home'; window.__coDesk = '';
  };

  window.ARCOCart_deliv = function (type) {
    coDelivery = type;
    document.getElementById('co-home').classList.toggle('active', type === 'home');
    document.getElementById('co-pickup').classList.toggle('active', type === 'pickup');
    document.getElementById('co-commune-wrap').style.display = type === 'home' ? 'grid' : 'none';
    document.getElementById('co-desk-wrap').style.display = type === 'pickup' ? 'grid' : 'none';
    if (type === 'pickup') loadDesks();
    updateCoTotal();
  };

  window.ARCOCart_wilaya = async function () {
    const val = document.getElementById('co-wilaya').value; if (!val) return;
    const id = val.split('|')[0];
    populateCommunes(id);
    try {
      const r = await fetch(`${SB_URL}/shipping_rates?wilaya_id=eq.${Number(id)}&select=home_delivery,stop_desk&limit=1`, { headers: H });
      const data = await r.json(); coShipping = data[0] || { home_delivery: 0, stop_desk: 0 };
    } catch { coShipping = { home_delivery: 0, stop_desk: 0 }; }
    document.getElementById('co-home-p').textContent = money(coShipping.home_delivery);
    document.getElementById('co-pickup-p').textContent = money(coShipping.stop_desk);
    if (coDelivery === 'pickup') loadDesks();
    updateCoTotal();
  };

  function populateCommunes(wilayaId) {
    const sel = document.getElementById('co-commune'); if (!sel) return;
    const communes = WILAYA_COMMUNES[String(wilayaId).padStart(2, '0')] || [];
    sel.innerHTML = '<option value="">اختر البلدية</option>' + communes.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
  }

  async function validateCart() {
    const cart = read(); if (!cart.length) return;
    const slugs = [...new Set(cart.map(i => String(i.product_slug || '').trim()).filter(Boolean))];
    const status = {};
    await Promise.all(slugs.map(async (s) => {
      try {
        const r = await fetch(`${SB_URL}/products?select=slug&active=eq.true&slug=ilike.${encodeURIComponent(s)}&limit=1`, { headers: H });
        if (!r.ok) return;
        const d = await r.json();
        status[s.toLowerCase()] = (Array.isArray(d) && d.length) ? 'alive' : 'dead';
      } catch {}
    }));
    const filtered = cart.filter(i => status[String(i.product_slug || '').trim().toLowerCase()] !== 'dead');
    if (filtered.length !== cart.length) { write(filtered); renderDrawer(); }
  }

  async function loadDesks() {
    const sel = document.getElementById('co-desk'); if (!sel) return;
    if (!coDesks) { try { const r = await fetch('/api/noest-desks'); if (r.ok) coDesks = await r.json(); } catch {} }
    const id = (document.getElementById('co-wilaya').value || '').split('|')[0];
    const entries = Object.entries(coDesks || {}).filter(([code]) => id && new RegExp('^' + id + '[A-Z]').test(code));
    sel.innerHTML = '<option value="">اختر النقطة</option>' + entries.map(([code, dk]) => `<option value="${code}">${esc(dk.name || code)}</option>`).join('');
  }

  function coShipCost() { return coDelivery === 'home' ? Number(coShipping.home_delivery || 0) : Number(coShipping.stop_desk || 0); }
  function updateCoTotal() {
    const t = computeTotals(read());
    const ship = coShipCost();
    const s = document.getElementById('co-ship'), tot = document.getElementById('co-total');
    if (s) s.textContent = money(ship);
    if (tot) tot.textContent = money(t.total + ship);
  }

  window.ARCOCart_submit = async function () {
    const cart = read(); if (!cart.length) return;
    const name = document.getElementById('co-name').value.trim();
    const phone = document.getElementById('co-phone').value.replace(/\s/g, '');
    const wilayaVal = document.getElementById('co-wilaya').value;
    const commune = (document.getElementById('co-commune') || {}).value || '';
    const desk = window.__coDesk || '';
    if (!name) return alert('أدخل الاسم');
    if (!/^0[567]\d{8}$/.test(phone)) return alert('رقم الهاتف غير صحيح');
    if (!wilayaVal) return alert('اختر الولاية');
    if (!coShipCost()) return alert('اختر ولاية متوفرة');
    if (coDelivery === 'home' && !commune.trim()) return alert('اكتب البلدية');
    if (coDelivery === 'pickup' && !desk) return alert('اختر نقطة الاستلام');
    const [wid, wname] = wilayaVal.split('|');
    const btn = document.getElementById('co-submit'); btn.textContent = 'جاري الإرسال...'; btn.disabled = true;
    const t = computeTotals(cart);
    const value = t.total + coShipCost();
    const payload = {
      name, phone, wilaya: wname, wilaya_id: Number(wid),
      commune: coDelivery === 'home' ? commune.trim() : '',
      delivery_type: coDelivery, station_code: coDelivery === 'pickup' ? desk : null,
      event_source_url: location.href,
      attribution: window.ARCOAttribution?.getPayload?.(),
      cart_discount: t.totalDiscount,
      items: cart.map(it => ({ product_slug: it.product_slug, variant_label: it.variant, selected_options: it.selected_options || null }))
    };
    try {
      const r = await fetch('/api/create-order', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const result = await r.json().catch(() => ({}));
      if (!r.ok || !result.ok) throw new Error(result.error || 'failed');
      if (window.ARCOMeta) window.ARCOMeta.trackPurchase({ content_name: 'Cart', value, currency: 'DZD', eventID: result.order_id, num_items: cart.length });
      if (window.ARCOTikTok) window.ARCOTikTok.trackPurchase({ content_name: 'Cart', value, currency: 'DZD', eventID: result.order_id });
      localStorage.removeItem(KEY); renderBadge(); notifyChange();
      closeDrawer();
      // Success screen — push to browse more
      const sx = document.getElementById('arco-success');
      let last = '';
      try { last = localStorage.getItem('arco_last_collection') || ''; } catch {}
      const browseHref = last ? `/c/${encodeURIComponent(last)}` : '/';
      sx.innerHTML = `<div class="arco-success-box">
        <div class="arco-success-icon">🎉</div>
        <h2>تم استلام الطلب!</h2>
        <p>شكراً ${esc(name)}!<br>طلبك رقم <strong>#${esc(result.order_id)}</strong> تم بنجاح.<br>سيتواصل معك فريق ARCO قريباً لتأكيد التفاصيل.</p>
        <div class="arco-success-upsell">
          <p>🛍️ تصفح باقي اللوحات وأضف أكثر لمجموعتك!</p>
          <a class="arco-success-browse-btn" href="${browseHref}">تصفح المجموعات</a>
          <br>
          <a class="arco-success-home-btn" href="/">العودة للرئيسية</a>
        </div>
      </div>`;
      sx.classList.add('show');
    } catch (e) {
      btn.textContent = 'تأكيد الطلب (الدفع عند الاستلام)'; btn.disabled = false;
      const m = (e && e.message && e.message !== 'failed' && e.message !== 'Failed') ? e.message : 'حدث خطأ. حاول مرة أخرى';
      alert(m);
    }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ensureUI);
  else ensureUI();
})();
