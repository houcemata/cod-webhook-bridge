/* ARCO cart.js — self-contained cart for POSTER products.
   Include on any page with: <script src="/cart.js"></script>
   Posters add to cart; sets order directly (untouched).
   Every 3rd poster (cheapest of each 3) is free. One COD checkout. */
(function () {
  "use strict";
  const SB_URL = 'https://mpkpehuatqsubohltssi.supabase.co/rest/v1';
  const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1wa3BlaHVhdHFzdWJvaGx0c3NpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5OTc0NzUsImV4cCI6MjA5NTU3MzQ3NX0.v65rahP8E26xAnbcfOHJToKsja6q_A8v3Kxki8LAymk';
  const H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' };
  const KEY = 'arco_cart_v1';

  // in-memory cart (NOT localStorage — survives only the session, per Artifact rules
  // does not apply here since this is the real site; we DO persist via localStorage)
  function read() { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; } }
  function write(c) { localStorage.setItem(KEY, JSON.stringify(c)); renderBadge(); }
  function money(v) { return Number(v || 0).toLocaleString('fr-DZ') + ' DZD'; }
  function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

  // ---- pricing: cheapest of every 3 is free ----
  function computeTotals(cart) {
    const prices = cart.map(i => Number(i.price || 0));
    const freeCount = Math.floor(cart.length / 3);
    const idxSortedByPrice = cart.map((it, i) => i).sort((a, b) => prices[a] - prices[b]);
    const freeIdx = new Set(idxSortedByPrice.slice(0, freeCount));
    let subtotal = 0, discount = 0;
    cart.forEach((it, i) => { subtotal += prices[i]; if (freeIdx.has(i)) discount += prices[i]; });
    return { subtotal, discount, total: subtotal - discount, freeCount, freeIdx };
  }

  // ---- public API ----
  window.ARCOCart = {
    add(item) {
      // item: {product_slug, product, variant, selected_options, price, image}
      const cart = read();
      cart.push(item);
      write(cart);
      openAdded(item);
    },
    count() { return read().length; },
    open: openDrawer,
  };

  // ---- floating button + badge ----
  function ensureUI() {
    if (document.getElementById('arco-cart-fab')) return;
    const fab = document.createElement('button');
    fab.id = 'arco-cart-fab';
    fab.innerHTML = `🛒<span id="arco-cart-badge">0</span>`;
    fab.onclick = openDrawer;
    document.body.appendChild(fab);

    const style = document.createElement('style');
    style.textContent = `
      #arco-cart-fab{position:fixed;bottom:20px;right:20px;z-index:60;width:58px;height:58px;border-radius:50%;border:none;background:#F5C500;color:#080808;font-size:24px;cursor:pointer;box-shadow:0 10px 30px rgba(245,197,0,.4);display:flex;align-items:center;justify-content:center}
      #arco-cart-badge{position:absolute;top:-4px;right:-4px;background:#e11d48;color:#fff;font:700 12px/1 'Cairo',sans-serif;min-width:20px;height:20px;border-radius:999px;display:flex;align-items:center;justify-content:center;padding:0 5px}
      #arco-cart-badge.zero{display:none}
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
      .arco-promo{background:rgba(34,197,94,.12);border:1px solid rgba(34,197,94,.3);color:#5ef0a0;border-radius:12px;padding:12px;text-align:center;font:700 .9rem/1.4 'Cairo',sans-serif;margin-bottom:12px}
      .arco-promo.near{background:rgba(245,197,0,.1);border-color:rgba(245,197,0,.3);color:#F5C500}
      .arco-empty{text-align:center;color:#888;padding:50px 20px}
      .arco-foot{border-top:1px solid rgba(255,255,255,.08);padding:16px}
      .arco-sum{display:flex;justify-content:space-between;margin-bottom:6px;color:#ccc;font-size:.9rem}
      .arco-sum.tot{color:#fff;font-weight:800;font-size:1.05rem;border-top:1px solid rgba(255,255,255,.08);padding-top:8px;margin-top:8px}
      .arco-sum.disc{color:#22c55e}
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
      .arco-success-icon{font-size:52px;margin-bottom:6px}
      .arco-success h2{color:#F5C500;font-size:2rem;margin-bottom:10px}
      .arco-success p{color:#ddd;line-height:1.8}
      .arco-success-call-note{color:#999;font-size:13px;margin-top:14px}
      .arco-success-phone-wrap{margin-top:10px;display:grid;justify-items:center;gap:6px}
      .arco-success-phone-btn{background:#F5C500;color:#080808;border:0;border-radius:8px;padding:13px 22px;font-weight:900;font-size:18px;letter-spacing:1px;cursor:pointer;font-family:'Cairo',sans-serif}
      .arco-success-copy-hint{color:#999;font-size:12px}
      .arco-success button.arco-home-btn{margin-top:18px;background:#F5C500;color:#080808;border:none;border-radius:10px;padding:12px 24px;font-weight:800;cursor:pointer}
      .arco-success-copy-toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:#181818;color:#fff;border:1px solid rgba(255,255,255,.12);border-radius:999px;padding:10px 18px;z-index:110;opacity:0;pointer-events:none;transition:.2s}
      .arco-success-copy-toast.show{opacity:1}
      @media(max-width:640px){
        .arco-added{left:14px;right:14px;bottom:84px;max-width:none;padding:18px 20px;border-radius:18px}
        .arco-added .t{font-size:1.05rem;margin-bottom:10px}
        .arco-added div[style]{font-size:.95rem !important}
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
    const b = document.getElementById('arco-cart-badge');
    if (!b) return;
    const n = read().length;
    b.textContent = n;
    b.classList.toggle('zero', n === 0);
  }

  function openAdded(item) {
    ensureUI();
    const n = read().length;
    const need = (3 - (n % 3)) % 3;
    let promo = '';
    if (n % 3 === 0 && n > 0) promo = `🎉 رائع! عندك ${n / 3} قطعة مجانية!`;
    else if (need === 1) promo = `🔥 زيد قطعة وحدة و الثالثة بااااطل!`;
    const el = document.getElementById('arco-added');
    el.innerHTML = `
      <div class="t">✓ تمت الإضافة إلى السلة</div>
      <div style="font-size:.85rem;color:#ccc">${esc(item.product)} — ${esc(item.variant)}</div>
      ${promo ? `<div style="margin-top:8px;color:#5ef0a0;font-weight:700;font-size:.85rem">${promo}</div>` : ''}
      <div class="btns">
        <button class="b1" onclick="ARCOCart.open()">عرض السلة (${n})</button>
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
      d.innerHTML = `<div class="arco-dh"><h3>سلة المشتريات</h3><button onclick="document.getElementById('arco-drawer').classList.remove('show');document.getElementById('arco-ov').classList.remove('show')">×</button></div><div class="arco-empty">سلتك فارغة 🛒<br><br>أضف لوحات و استفد من عرض: اشترِ 2 و الثالثة مجاناً!</div>`;
      return;
    }
    const t = computeTotals(cart);
    const need = (3 - (cart.length % 3)) % 3;
    let promoHtml = '';
    if (t.freeCount > 0) promoHtml = `<div class="arco-promo">🎉 عندك ${t.freeCount} قطعة مجانية! وفّرت ${money(t.discount)}</div>`;
    else if (need > 0) promoHtml = `<div class="arco-promo near">🔥 زيد ${need} ${need === 1 ? 'قطعة' : 'قطع'} و القطعة الثالثة بااااطل!</div>`;

    d.innerHTML = `
      <div class="arco-dh"><h3>سلة المشتريات (${cart.length})</h3><button onclick="document.getElementById('arco-drawer').classList.remove('show');document.getElementById('arco-ov').classList.remove('show')">×</button></div>
      <div class="arco-items">
        ${promoHtml}
        ${cart.map((it, i) => {
          const free = t.freeIdx.has(i);
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
        ${t.discount > 0 ? `<div class="arco-sum disc"><span>الخصم (قطع مجانية)</span><span>- ${money(t.discount)}</span></div>` : ''}
        <div class="arco-sum tot"><span>المجموع (بدون توصيل)</span><span>${money(t.total)}</span></div>
        <button class="arco-cta" onclick="ARCOCart_checkout()">إتمام الطلب</button>
        <button class="arco-browse" onclick="ARCOCart_browseMore()">تصفح المزيد</button>
      </div>`;
  }

  window.ARCOCart_remove = function (i) { const c = read(); c.splice(i, 1); write(c); renderDrawer(); };

  // "Browse more" sends the customer straight to the collection page of
  // whichever collection they last added a poster from (set by
  // product.html on add-to-cart). Used by both the toast and the drawer.
  window.ARCOCart_browseMore = function () {
    document.getElementById('arco-added').classList.remove('show');
    closeDrawer();
    let last = '';
    try { last = localStorage.getItem('arco_last_collection') || ''; } catch {}
    location.href = last ? `/c/${encodeURIComponent(last)}` : '/';
  };

  // ---- checkout form (inside drawer) ----
  const WILAYAS = [['01','Adrar'],['02','Chlef'],['03','Laghouat'],['04','Oum El Bouaghi'],['05','Batna'],['06','Bejaia'],['07','Biskra'],['08','Bechar'],['09','Blida'],['10','Bouira'],['11','Tamanrasset'],['12','Tebessa'],['13','Tlemcen'],['14','Tiaret'],['15','Tizi Ouzou'],['16','Algiers'],['17','Djelfa'],['18','Jijel'],['19','Setif'],['20','Saida'],['21','Skikda'],['22','Sidi Bel Abbes'],['23','Annaba'],['24','Guelma'],['25','Constantine'],['26','Medea'],['27','Mostaganem'],['28',"M'Sila"],['29','Mascara'],['30','Ouargla'],['31','Oran'],['32','El Bayadh'],['33','Illizi'],['34','Bordj Bou Arreridj'],['35','Boumerdes'],['36','El Tarf'],['37','Tindouf'],['38','Tissemsilt'],['39','El Oued'],['40','Khenchela'],['41','Souk Ahras'],['42','Tipaza'],['43','Mila'],['44','Ain Defla'],['45','Naama'],['46','Ain Temouchent'],['47','Ghardaia'],['48','Relizane'],['49','Timimoun'],['50','Bordj Badji Mokhtar'],['51','Ouled Djellal'],['52','Beni Abbes'],['53','In Salah'],['54','In Guezzam'],['55','Touggourt'],['56','Djanet'],['57',"El M'Ghair"],['58','El Menia']];
  const WILAYA_DATA={"01 - Adrar":["Adrar","Akabli","Aougrout","Aoulef","Bouda","Charouine","Deldoul","Fenoughil","Reggane","Sali","Sbaa","Talmine","Tamentit","Timimoun","Tinerkouk","Tit","Tsabit","Zaouiet Kounta"],"02 - Chlef":["Abou El Hassen","Ain Merane","Benairia","Beni Haoua","Beni Rached","Boukadir","Breira","Chettia","Chlef","Dahra","El Hadjadj","El Karimia","El Marsa","Harchoun","Herenfa","Moussadek","Oued Fodda","Oued Sly","Ouled Fares","Sendjas","Sobha","Tadjna","Taougrite","Tenes","Zeboudja"],"03 - Laghouat":["Aflou","Ain Mahdi","Brida","El Ghicha","El Haouaita","Gueltat Sidi Saad","Hadj Mechri","Hassi Delaa","Hassi R'Mel","Ksar El Hirane","Laghouat","Oued M'Zi","Sidi Makhlouf","Tadjmout"],"04 - Oum El Bouaghi":["Ain Beida","Ain Fekroune","Ain Kercha","Ain M'lila","Berriche","El Amiria","El Djazia","Fkirina","Ksar Sbahi","Meskiana","Oum El Bouaghi","Rahia","Sigus","Souk Naamane"],"05 - Batna":["Ain Touta","Arris","Barika","Batna","Bouzina","Chemora","El Madher","Fesdis","Ghassira","Ichmoul","Ksar Belezma","Larbaa","Menaa","Merouana","N Gaous","Oued Chaaba","Ras El Aioun","Seriana","Tazoult","Timgad","Tkout"],"06 - Bejaia":["Adekar","Akbou","Akfadou","Amalou","Amizour","Aokas","Barbacha","Bejaia","Beni Ksila","Chemini","Darguina","El Kseur","Feraoun","Ighil Ali","Ighram","Kendira","Kherrata","Melbou","Oued Ghir","Seddouk","Sidi Aich","Souk El Thenine","Tazmalt","Tichi","Toudja"],"07 - Biskra":["Ain Naga","Biskra","Chetma","Djemorah","Doucen","El Kantara","El Outaya","Foughala","Lichana","M'lili","Mchouneche","Ouled Djellal","Oumache","Sidi Khaled","Sidi Okba","Tolga","Zeribet El Oued"],"08 - Bechar":["Abadla","Bechar","Beni Abbes","Beni Ounif","Boukais","Igli","Kenedsa","Kerzaz","Lahmar","Mogheul","Taghit","Timoudi"],"09 - Blida":["Ain Romana","Beni Mered","Blida","Bouarfa","Boufarik","Bougara","Bouinan","Chebli","Chiffa","El Affroun","Guerrouaou","Hammam Melouane","Larbaa","Meftah","Mouzaia","Oued El Alleug","Ouled Yaich","Soumaa"],"10 - Bouira":["Aghbalou","Ain Bessem","Ain El Hadjar","Bechloul","Bir Ghbalou","Bordj Oukhriss","Bouira","Chorfa","Djebahia","El Adjiba","El Hachimia","El Mokrani","Haizer","Kadiria","Lakhdaria","Mchedallah","Oued El Berdi","Ouled Rached","Saharidj","Souk El Khemis","Sour El Ghozlane","Taghzout"],"11 - Tamanrasset":["Abalessa","Idles","In Amguel","In Ghar","In Guezzam","In Salah","Tamanrasset","Tinzaouatine"],"12 - Tebessa":["Ain Zerga","Bekkaria","Bir El Ater","Bir El Mokadem","Boukhadra","Boulhaf Dyr","Cheria","El Aouinet","El Kouif","El Ma El Biodh","El Meridj","Ferkane","Hammamet","Morsot","Negrine","Ouenza","Oum Ali","Tebessa","Tlidjene"],"13 - Tlemcen":["Ain Fezza","Ain Ghoraba","Ain Nehala","Ain Tallout","Bab El Assa","Beni Bahdel","Beni Boussaid","Beni Mester","Beni Snous","Bensekrane","Chetouane","El Aricha","Fellaoucene","Ghazaouet","Hammam Boughrara","Hennaya","Honaine","Maghnia","Mansourah","Nedroma","Ouled Mimoun","Remchi","Sebdou","Sidi Abdelli","Sidi Djillali","Souahlia","Tlemcen"],"14 - Tiaret":["Ain Bouchekif","Ain Deheb","Ain El Hadid","Chehaima","Dahmouni","Frenda","Guertoufa","Hamadia","Ksar Chellala","Mahdia","Meghila","Naima","Oued Lilli","Rahouia","Rechaiga","Sidi Hosni","Sougueur","Tagdemt","Takhemaret","Tiaret","Tidda","Tousnina"],"15 - Tizi Ouzou":["Ain El Hammam","Ain Zaouia","Azazga","Azzefoun","Beni Yenni","Boghni","Boudjima","Bouzguene","Draa Ben Khedda","Draa El Mizan","Freha","Iferhounene","Iflissen","Larba Nath Irathen","Maatkas","Makouda","Mekla","Ouacif","Ouadhia","Ouaguenoun","Souk El Thenine","Tadmait","Tigzirt","Timizart","Tizi Ouzou","Tizi Rached","Yakourene"],"16 - Algiers":["Ain Benian","Ain Taya","Alger Centre","Bab El Oued","Bab Ezzouar","Baba Hesen","Bachedjerah","Baraki","Ben Aknoun","Bir Mourad Rais","Bir Touta","Birkhadem","Bordj El Bahri","Bordj El Kiffan","Bourouba","Bouzareah","Casbah","Cheraga","Dar El Beida","Dely Ibrahim","Douira","Draria","El Achour","El Biar","El Harrach","El Madania","El Mouradia","Herraoua","Hussein Dey","Hydra","Kheraisia","Kouba","Marsa","Mohamed Belouzdad","Mohammadia","Oued Smar","Ouled Fayet","Rahmania","Reghaia","Rouiba","Sidi M'hamed","Sidi Moussa","Souidania","Zeralda"],"17 - Djelfa":["Ain El Ibel","Ain Oussera","Benhar","Birine","Charef","Djelfa","El Idrissia","El Khemis","Guernini","Had Sahary","Hassi Bahbah","Hassi El Euch","M'Liliha","Messaad","Moudjebara","Sidi Ladjel","Zaafrane"],"18 - Jijel":["Bordj T'her","Chekfa","El Ancer","El Aouana","El Milia","Erraguene","Jijel","Ouadjana","Sidi Abdelaziz","Taher","Texena","Ziamma Mansouriah"],"19 - Setif":["Ain Abessa","Ain Arnat","Ain El Kebira","Ain Oulmane","Amoucha","Babor","Beni Aziz","Beni Ouartilane","Bir El Arch","Bouandas","Bougaa","Bousselam","Boutaleb","Djemila","El Eulma","El Ouricia","Guenzet","Guidjel","Hamma","Hammam Guergour","Mezloug","Ouled Sabor","Rosfa","Salah Bey","Setif","Taya","Tella"],"20 - Saida":["Ain El Hadjar","Ain Sekhouna","Doui Thabet","El Hassasna","Moulay Larbi","Ouled Brahim","Saida","Sidi Boubekeur","Youb"],"21 - Skikda":["Ain Cherchar","Azzaba","Collo","El Harrouch","El Marsa","Kerkera","Ramdane Djamel","Sidi Mezghiche","Skikda","Tamalous","Zitouna"],"22 - Sidi Bel Abbes":["Ain El Berd","Belarbi","Ben Badis","Bir El Hammam","Dhaya","Lamtar","Makedra","Marhoum","Merine","Mostefa Ben Brahim","Moulay Slissen","Ras El Ma","Sfissef","Sidi Ali Benyoub","Sidi Bel Abbes","Sidi Brahim","Tabia","Telagh","Tenira","Tessala"],"23 - Annaba":["Ain Berda","Annaba","Berrahel","Chetaibi","El Bouni","El Hadjar","Seraidi","Sidi Amer"],"24 - Guelma":["Ain Ben Beida","Ain Larbi","Ain Makhlouf","Ain Reggada","Belkhir","Bouchegouf","Guelma","Hammam Maskhoutine","Heliopolis","Medjez Amar","Nechmaya","Oued Zenati","Roknia","Tamlouka"],"25 - Constantine":["Ain Abid","Ain Smara","Beni Hamiden","Constantine","Didouche Mourad","El Khroub","Hamma Bouziane","Ibn Badis","Ibn Ziad","Ouled Rahmoune","Zighoud Youcef"],"26 - Medea":["Ain Boucif","Berrouaghia","Boghar","Boughezoul","El Hamdania","El Omaria","Ksar El Boukhari","Medea","Meftaha","Mihoub","Ouled Antar","Sedraia","Sidi Naamane","Souagui","Tablat","Zoubiria"],"27 - Mostaganem":["Achaacha","Ain Nouissy","Ain Tadles","Bouguirat","El Hassiane","Hadjadj","Hassi Mameche","Mostaganem","Oued El Kheir","Ouled Boughalem","Safsaf","Sayada","Sidi Ali","Sidi Lakhdar","Stidia","Touahria"],"28 - M'Sila":["Ain El Hadjel","Ain El Melh","Beni Ilmane","Bir Foda","Bou Saada","Chellal","El Hamel","Hammam Dhalaa","M'sila","Maadid","Magra","Medjedel","Ouanougha","Ouled Addi Guebala","Ouled Mansour","Sidi Aissa","Sidi Ameur","Zarzour"],"29 - Mascara":["Ain Fekan","Alaimia","Aouf","Benian","Bou Hanifia","Chorfa","El Bordj","El Hachem","Froha","Ghriss","Hacine","Maoussa","Mascara","Mohammadia","Oggaz","Oued El Abtal","Oued Taria","Sehailia","Sidi Abdelmoumene","Sig","Teghennif","Zahana"],"30 - Ouargla":["Ain Beida","Benaceur","El Allia","El Hadjira","Hassi Ben Abdellah","Hassi Messaoud","Megarine","Nezla","Ngoussa","Ouargla","Rouissat","Sidi Khouiled","Taibet","Tamacine","Touggourt","Zaouia El Abidia"],"31 - Oran":["Ain Biya","Ain Turk","Arzew","Ben Freha","Bethioua","Bir El Djir","Boufatis","Bousfer","Boutlelis","El Karma","Es Senia","Gdyel","Hassi Ben Okba","Hassi Bounif","Mers El Kebir","Messerghin","Oran","Oued Tlelat","Sidi Ben Yebka","Sidi Chami","Tafraoui"],"32 - El Bayadh":["Boualem","Brezina","El Abiodh Sidi Cheikh","El Bayadh","El Bnoud","El Kheither","Ghassoul","Rogassa","Sidi Ameur","Sidi Slimane"],"33 - Illizi":["Bordj El Haouasse","Bordj Omar Driss","Debdeb","Djanet","Illizi","In Amenas"],"34 - Bordj Bou Arreridj":["Ain Taghrout","Belimour","Bir Kasdali","Bordj Bou Arreridj","Bordj Ghdir","Bordj Zemoura","Djaafra","El Achir","El Hamadia","El Main","Ghilassa","Hasnaoua","Khelil","Mansoura","Medjana","Ouled Brahem","Ras El Oued","Sidi Embarek","Teniet En Nasr","Tixter"],"35 - Boumerdes":["Afir","Ammal","Baghlia","Beni Amrane","Bordj Menaiel","Boudouaou","Boumerdes","Chabet El Ameur","Corso","Dellys","Djinet","El Kharrouba","Hammedi","Isser","Khemis El Khechna","Larbatache","Naciria","Ouled Aissa","Ouled Moussa","Si Mustapha","Sidi Daoud","Souk El Had","Thenia","Tidjelabine","Timezrit","Zemmouri"],"36 - El Tarf":["Ain El Assel","Ben M Hidi","Besbes","Bouhadjar","Bouteldja","Chefia","Drean","El Kala","El Tarf","Oued Zitoun","Zitouna"],"37 - Tindouf":["Oum El Assel","Tindouf"],"38 - Tissemsilt":["Bordj Bou Naama","Boucaid","Khemisti","Lardjem","Layoune","Lazharia","Melaab","Ouled Bessem","Sidi Abed","Sidi Lantri","Sidi Slimane","Theniet El Had","Tissemsilt"],"39 - El Oued":["Bayadha","Debila","Djamaa","El Mghair","El Ogla","El Oued","Guemar","Hassi Khelifa","Kouinine","Mrara","Nakhla","Oued El Alenda","Oum Touyour","Reguiba","Robbah","Sidi Amrane","Sidi Aoun","Still","Taghzout","Taleb Larbi","Tendla"],"40 - Khenchela":["Ain Touila","Babar","Baghai","Bouhmama","Chelia","Cherchar","Djellal","El Hamma","El Mahmal","Kais","Khenchela","Msara","Ouled Rechache","Remila","Tamza","Yabous"],"41 - Souk Ahras":["Ain Soltane","Bir Bouhouche","Haddada","Hanancha","Khedara","Khemissa","M'daourouche","Mechroha","Merahna","Oued Keberit","Ouled Driss","Sedrata","Sidi Fredj","Souk Ahras","Taoura","Tiffech"],"42 - Tipaza":["Ain Tagourait","Attatba","Bou Haroun","Bou Ismail","Bourkika","Cherchell","Damous","Douaouda","Fouka","Gouraya","Hadjout","Khemisti","Kolea","Larhat","Menaceur","Meurad","Sidi Amar","Sidi Ghiles","Sidi Rached","Tipaza"],"43 - Mila":["Ahmed Rachedi","Ain Mellouk","Amira Arras","Chelghoum Laid","El Mechira","Ferdjioua","Grarem Gouga","Mila","Minar Zarza","Oued Athmenia","Oued Endja","Rouached","Sidi Khelifa","Sidi Merouane","Tadjenanet","Telerghma","Zeghaia"],"44 - Ain Defla":["Ain Benian","Ain Defla","Ain Lechiakh","Arib","Belaas","Bordj Emir Khaled","Boumedfaa","Djelida","Djendel","El Abadia","El Amra","El Attaf","Hammam Righa","Khemis Miliana","Miliana","Oued Chorfa","Rouina","Sidi Lakhdar","Zeddine"],"45 - Naama":["Ain Ben Khelil","Ain Sefra","El Biod","Kasdir","Mechria","Moghrar","Naama","Sfissifa","Tiout"],"46 - Ain Temouchent":["Ain El Arbaa","Ain Kihal","Ain Temouchent","Ain Tolba","Beni Saf","Bou Zedjar","El Amria","El Malah","Hammam Bouhadjar","Hassi El Ghella","Oued Berkeche","Ouled Boudjemaa","Ouled Kihal","Sidi Ben Adda","Sidi Boumediene","Sidi Safi","Tamzoura","Terga"],"47 - Ghardaia":["Berriane","Bounoura","El Atteuf","El Guerrara","El Meniaa","Ghardaia","Hassi Fehal","Mansoura","Metlili","Sebseb","Zelfana"],"48 - Relizane":["Ain Rahma","Ammi Moussa","Bendaoud","Beni Zentis","Djidiouia","El Guettar","El Hamadna","El Matmar","Had Echkalla","Kalaa","Lahlef","Mazouna","Mediouna","Ouarizane","Oued Rhiou","Relizane","Sidi Khettab","Sidi M'hamed Benali","Sidi Saada","Yellel","Zemmoura"],"49 - Timimoun":["Aougrout","Charouine","Deldoul","Metarfa","Ouled Aissa","Talmine","Timimoun","Tinerkouk"],"50 - Bordj Badji Mokhtar":["Bordj Badji Mokhtar","Timiaouine"],"51 - Ouled Djellal":["Besbes","Chaiba","Doucen","Ouled Djellal","Ras El Miad","Sidi Khaled"],"52 - Beni Abbes":["Beni-Abbes","Beni-Ikhlef","El Ouata","Igli","Kerzaz","Ksabi","Tamtert","Timoudi"],"53 - In Salah":["Ain Salah","Foggaret Ezzoua","Inghar"],"54 - In Guezzam":["In Guezzam","Tin Zaouatine"],"55 - Touggourt":["Blidet Amor","El Alia","El-Hadjira","Megarine","Nezla","Sidi Slimane","Taibet","Tebesbest","Temacine","Touggourt","Zaouia El Abidia"],"56 - Djanet":["Bordj El Haouass","Djanet"],"57 - El M'Ghair":["Djamaa","El-M'ghaier","M'rara","Oum Touyour","Sidi Amrane","Sidi Khelil","Still","Tenedla"],"58 - El Menia":["El Meniaa","Hassi Fehal","Hassi Gara"]};
  const WILAYA_COMMUNES=Object.fromEntries(Object.entries(WILAYA_DATA).map(([key,value])=>[key.slice(0,2),value]));
  let coShipping = { home_delivery: 0, stop_desk: 0 }, coDelivery = 'home', coDesks = null, coDesk = '';

  window.ARCOCart_checkout = function () {
    const cart = read(); if (!cart.length) return;
    const t = computeTotals(cart);
    const d = document.getElementById('arco-drawer');
    d.innerHTML = `
      <div class="arco-dh"><h3>إتمام الطلب</h3><button onclick="ARCOCart.open()">→</button></div>
      <div class="arco-items">
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
    coDelivery = 'home'; coDesk = '';
  };

  window.ARCOCart_deliv = function (type) {
    coDelivery = type; coDesk = '';
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

  // Self-heal: when the drawer opens, drop any saved item whose slug no longer
  // resolves to an active product (e.g. a product that was renamed or deleted).
  // Only removes items we CONFIRM are gone — network errors leave the cart intact.
  async function validateCart() {
    const cart = read();
    if (!cart.length) return;
    const slugs = [...new Set(cart.map(i => String(i.product_slug || '').trim()).filter(Boolean))];
    const status = {};
    await Promise.all(slugs.map(async (s) => {
      try {
        const r = await fetch(`${SB_URL}/products?select=slug&active=eq.true&slug=ilike.${encodeURIComponent(s)}&limit=1`, { headers: H });
        if (!r.ok) return;
        const d = await r.json();
        status[s.toLowerCase()] = (Array.isArray(d) && d.length) ? 'alive' : 'dead';
      } catch { /* unknown — leave it */ }
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
    const payload = {
      name, phone, wilaya: wname, wilaya_id: Number(wid),
      commune: coDelivery === 'home' ? commune.trim() : '',
      delivery_type: coDelivery, station_code: coDelivery === 'pickup' ? desk : null,
      event_source_url: location.href,
      items: cart.map(it => ({ product_slug: it.product_slug, variant_label: it.variant, selected_options: it.selected_options || null }))
    };
    try {
      const r = await fetch('/api/create-order', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const result = await r.json().catch(() => ({}));
      if (!r.ok || !result.ok) throw new Error(result.error || 'failed');
      // analytics (uses existing pixels if present)
      const t = computeTotals(cart);
      const value = t.total + coShipCost();
      if (window.ARCOMeta) window.ARCOMeta.trackPurchase({ content_name: 'Cart', value, currency: 'DZD', eventID: result.order_id, num_items: cart.length });
      if (window.ARCOTikTok) window.ARCOTikTok.trackPurchase({ content_name: 'Cart', value, currency: 'DZD', eventID: result.order_id });
      localStorage.removeItem(KEY); renderBadge();
      closeDrawer();
      const sx = document.getElementById('arco-success');
      sx.innerHTML = `<div>
        <div class="arco-success-icon">🎉</div>
        <h2>تم استلام الطلب!</h2>
        <p>شكراً ${esc(name)}!<br>طلبك تم بنجاح. سيتواصل معك فريق ARCO قريباً لتأكيد الطلب.</p>
        <p>#${esc(result.order_id)}</p>
        <div class="arco-success-call-note">احفظ هذا الرقم حتى نعاود الاتصال بك لاحقاً.</div>
        <div class="arco-success-phone-wrap">
          <button class="arco-success-phone-btn" id="arco-success-phone-btn" type="button">0550374607</button>
          <div class="arco-success-copy-hint">اضغط لنسخ الرقم</div>
        </div>
        <button class="arco-home-btn" onclick="location.href='/'">العودة للرئيسية</button>
      </div>`;
      sx.classList.add('show');
      const phoneBtn = document.getElementById('arco-success-phone-btn');
      const copyToast = document.getElementById('arco-success-copy-toast');
      if (phoneBtn && copyToast) {
        phoneBtn.onclick = async () => {
          const ph = '0550374607';
          try {
            if (navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText(ph);
            else throw new Error('clipboard unavailable');
          } catch (err) {
            const ta = document.createElement('textarea');
            ta.value = ph; ta.style.position = 'fixed'; ta.style.opacity = '0'; ta.setAttribute('readonly', '');
            document.body.appendChild(ta); ta.focus(); ta.select();
            document.execCommand('copy'); ta.remove();
          }
          copyToast.classList.add('show');
          clearTimeout(window.__arcoCartCopyToastT);
          window.__arcoCartCopyToastT = setTimeout(() => copyToast.classList.remove('show'), 1800);
        };
      }
    } catch (e) { btn.textContent = 'تأكيد الطلب (الدفع عند الاستلام)'; btn.disabled = false; const m = (e && e.message && e.message !== 'failed' && e.message !== 'Failed') ? e.message : 'حدث خطأ. حاول مرة أخرى'; alert(m); }
  };

  // init on load
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ensureUI);
  else ensureUI();
})();
