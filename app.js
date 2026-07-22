/* Chalon dans la Rue 2026 — planificateur
   Parcours : 1 Découvrir (swipe) → 2 Mes envies (review) → 3 Mon planning (calendrier + génération)
   Modèle de temps : marche réelle (GPS) + avance à prendre selon la jauge. */

const E = window.EVENTS, P = window.POINTS, SH = window.SHOWS;
const $  = id => document.getElementById(id);
const DAYS = [...new Set(E.map(e => e.d))];
const DAYNAME = {'2026-07-23':'Jeu 23','2026-07-24':'Ven 24','2026-07-25':'Sam 25','2026-07-26':'Dim 26'};
const DAYLONG = {'2026-07-23':'Jeudi 23 juillet','2026-07-24':'Vendredi 24 juillet',
                 '2026-07-25':'Samedi 25 juillet','2026-07-26':'Dimanche 26 juillet'};
const TYPES = [...new Set(E.flatMap(e => e.ty))].sort();
const HUE = {}; TYPES.forEach((t,i) => HUE[t] = `hsl(${(i*137+18)%360} 62% 52%)`);
const CATLBL = {'Sélection In':'In','Sélection Off':'Off','Auteurs en tandem':'Tandem'};
const CATS = Object.keys(CATLBL);
const REPS = ['Jeune public','Familial','Non-francophone'];

// niveaux d'envie
const LV = {
  3:  {lbl:'Je veux le voir absolument', short:'Absolument', ico:'★', col:'var(--must)'},
  2:  {lbl:'Ça m’intéresse',             short:'Ça m’intéresse', ico:'♥', col:'var(--want)'},
  1:  {lbl:'Peut-être',                  short:'Peut-être', ico:'?', col:'var(--maybe)'},
  0:  {lbl:'Non classés',                short:'Non classé', ico:'·', col:'var(--ink3)'},
 '-1':{lbl:'Pas pour moi',               short:'Refusé', ico:'✕', col:'var(--ink3)'}
};

// paliers de jauge → avance à prendre (minutes), réglables
const TIERS = [
  {id:'t100', lbl:'Jauge ≤ 100',    hint:'très petites jauges, file dès l’ouverture', def:60, test:j=>j>0&&j<=100},
  {id:'t200', lbl:'101 à 200',      hint:'', def:45, test:j=>j>100&&j<=200},
  {id:'t400', lbl:'201 à 400',      hint:'', def:30, test:j=>j>200&&j<=400},
  {id:'t800', lbl:'401 à 800',      hint:'', def:20, test:j=>j>400&&j<=800},
  {id:'tbig', lbl:'Plus de 800',    hint:'grands plateaux, peu de risque', def:15, test:j=>j>800},
  {id:'tunk', lbl:'Jauge inconnue', hint:'souvent en extérieur, sans limite affichée', def:20, test:j=>!j}
];
const MARGE_OPTS = [0,15,30,45,60,90,120];
const tierOf = j => TIERS.find(t => t.test(j)) || TIERS[5];

const T0=480, T1=1590, PX=1.9, MINH=114, MINMIN=Math.ceil(MINH/PX);

// ---------------------------------------------------------------- état
const S = {
  step:'discover', day:DAYS[0], view:'cal', q:'',
  types:new Set(), extra:new Set(), hide:false, onlyRanked:false,
  rank:new Map(),                       // url -> -1 | 1 | 2 | 3
  sel:new Set(),                        // index d'événements retenus
  days:new Set(DAYS),
  marges:Object.fromEntries(TIERS.map(t=>[t.id,t.def])),
  speed:4.2,
  revNone:false, revNo:false
};
const SW = {list:[], k:0, hist:[], dur:0, jauge:0, order:'rare', busy:false};

const byI = new Map(E.map(e => [e.i, e]));
const KEY = e => e.u+'@'+e.d+'@'+e.s;
const byKey = new Map(E.map(e => [KEY(e), e]));

function load(){
  try{
    const d = JSON.parse(localStorage.cdlr2026 || 'null');
    if(d){
      if(d.rank)   S.rank = new Map(Object.entries(d.rank));
      if(d.sel)    d.sel.forEach(k => {const e=byKey.get(k); if(e) S.sel.add(e.i)});
      if(d.days && d.days.length) S.days = new Set(d.days.filter(x => DAYS.includes(x)));
      if(d.marges) Object.assign(S.marges, d.marges);
      if(d.speed)  S.speed = d.speed;
      return;
    }
    // reprise de l'ancienne version
    JSON.parse(localStorage.cdlrwish  || '[]').forEach(u => S.rank.set(u,2));
    JSON.parse(localStorage.cdlrmaybe || '[]').forEach(u => S.rank.set(u,1));
    JSON.parse(localStorage.cdlrban   || '[]').forEach(u => S.rank.set(u,-1));
    JSON.parse(localStorage.cdlr26    || '[]').forEach(k => {const e=byKey.get(k); if(e) S.sel.add(e.i)});
    const dd = JSON.parse(localStorage.cdlrdays || 'null');
    if(Array.isArray(dd) && dd.length) S.days = new Set(dd.filter(x => DAYS.includes(x)));
  }catch(_){}
}
const save = () => {
  localStorage.cdlr2026 = JSON.stringify({
    rank:Object.fromEntries(S.rank), sel:[...S.sel].map(i=>KEY(byI.get(i))),
    days:[...S.days], marges:S.marges, speed:S.speed
  });
};
const rk = u => S.rank.get(u) || 0;
function setRank(u, v){
  if(v === 0) S.rank.delete(u); else S.rank.set(u, v);
  // seul un refus explicite retire du planning : « non classé » (0) est un état neutre,
  // et on accepte des non classés dans le planning (clic direct, suggestions).
  if(v < 0) E.forEach(e => {if(e.u === u) S.sel.delete(e.i)});
  save();
}

// ---------------------------------------------------------------- utilitaires
const fmt = m => String(Math.floor(m/60)%24).padStart(2,'0')+'h'+String(m%60).padStart(2,'0');
const dur = m => m == null ? '—'
  : m >= 60 ? (m%60 ? `${Math.floor(m/60)} h ${String(m%60).padStart(2,'0')}` : `${Math.floor(m/60)} h`)
  : `${m} min`;
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const venue = e => {const p=P[e.p]||{}; return {name:p.n||e.l||'', addr:p.a||e.l||'', lat:p.la, lon:p.lo}};
const venueLine = e => {const v=venue(e); return v.name && v.name!==v.addr ? `${v.name} — ${v.addr}` : v.addr};

const RAD = x => x*Math.PI/180, WC = {};
function walk(a, b){
  if(!a || !b) return 10;
  if(a === b) return 0;
  const k = (a<b?a+'_'+b:b+'_'+a)+'@'+S.speed;
  if(k in WC) return WC[k];
  const A=P[a], B=P[b]; if(!A || !B) return WC[k]=10;
  const h = Math.sin(RAD(B.la-A.la)/2)**2 + Math.cos(RAD(A.la))*Math.cos(RAD(B.la))*Math.sin(RAD(B.lo-A.lo)/2)**2;
  const km = 2*6371*Math.asin(Math.sqrt(h)) * 1.35;        // ×1,35 : détour des rues
  return WC[k] = Math.max(2, Math.ceil(km/S.speed*60) + 2); // +2 min pour trouver l'endroit
}
// avance à prendre avant le début (0 pour les passages libres)
const avance = e => e.w ? 0 : S.marges[tierOf(e.j).id];

/* Enchaînement de a (qui se termine) vers b (qui commence).
   vert  : on quitte a à temps pour arriver avec l'avance conseillée
   orange: on arrive après l'heure conseillée mais avant le lever de rideau
   rouge : on ne peut pas être là au début, ou les deux se chevauchent      */
function link(a, b){
  const w = walk(a.p, b.p);
  if(a.w || b.w) return {lvl:'free', walk:w};
  const idealDep = b.s - avance(b) - w;   // départ pour arriver à l'heure conseillée
  const lastDep  = b.s - w;               // départ pour arriver au début du spectacle
  if(b.s < a.e)      return {lvl:'bad', walk:w, overlap:a.e-b.s};
  if(a.e <= idealDep)return {lvl:'ok',   walk:w, slack:idealDep-a.e, dep:idealDep, arr:b.s-avance(b)};
  if(a.e <= lastDep) return {lvl:'warn', walk:w, late:a.e-idealDep, dep:a.e, arr:a.e+w};
  return {lvl:'bad', walk:w, short:a.e-lastDep};
}
const worse = (x,y) => ['free','ok','warn','bad'].indexOf(x) > ['free','ok','warn','bad'].indexOf(y) ? x : y;

const selected = () => [...S.sel].map(i => byI.get(i))
  .sort((a,b) => a.d.localeCompare(b.d) || a.s-b.s || a.e-b.e);

function status(e, sel){
  if(rk(e.u) === -1)     return 'no';
  if(S.sel.has(e.i))     return 'sel';
  for(const s of sel) if(s.u === e.u) return 'dup';
  if(!S.days.has(e.d))   return 'off';
  let lv = 'free';
  for(const s of sel){
    if(s.d !== e.d || s.w || e.w) continue;
    const [a,b] = e.s <= s.s ? [e,s] : [s,e];
    lv = worse(lv, link(a,b).lvl);
  }
  return lv === 'bad' ? 'blocked' : lv === 'warn' ? 'tight' : 'free';
}

// genres : OU · sélections In/Off/Tandem : OU · repères publics : ET
function passFilters(e){
  if(S.types.size && !e.ty.some(t => S.types.has(t))) return false;
  const cs = CATS.filter(c => S.extra.has(c));
  if(cs.length && !cs.some(c => e.ca.includes(CATLBL[c]))) return false;
  if(S.extra.has('Jeune public')     && !e.rp.includes('Jeune public')) return false;
  if(S.extra.has('Familial')         && !e.rp.includes('Familial')) return false;
  if(S.extra.has('Non-francophone')  && !e.rp.some(r => /francophone/.test(r))) return false;
  return true;
}

// ---------------------------------------------------------------- navigation
function go(step){
  S.step = step;
  document.querySelectorAll('.step').forEach(s => s.classList.toggle('on', s.id === 'step-'+step));
  document.querySelectorAll('#steps button').forEach(b => b.classList.toggle('on', b.dataset.s === step));
  if(step === 'discover'){ buildSwipeList(); drawFilterBar(); drawSwipe() }
  if(step === 'review')  drawReview();
  if(step === 'plan')    render();
}
$('steps').onclick = e => {const b = e.target.closest('button'); if(b) go(b.dataset.s)};
$('revDiscover').onclick = () => go('discover');
$('revReset').onclick = () => {
  if (confirm("Voulez-vous vraiment réinitialiser toutes vos envies ? Elles repasseront toutes en 'Non classées'.")) {
    S.rank.clear();
    save();
    drawReview();
  }
};
$('revToPlan').onclick   = () => {go('plan'); buildPlan()};
$('swClose').onclick     = () => go('review');

// ---------------------------------------------------------------- étape 1 : découvrir
const repsOf = u => E.filter(e => e.u === u).sort((a,b) => a.d.localeCompare(b.d) || a.s-b.s);
const matchesDiscover = e => passFilters(e)
  && (!SW.dur   || (e.e-e.s) <= SW.dur)
  && (!SW.jauge || (e.j && e.j >= SW.jauge));

function buildSwipeList(){
  const seen = new Set();
  const l = E.filter(e => S.days.has(e.d) && !rk(e.u) && matchesDiscover(e))
             .filter(e => !seen.has(e.u) && seen.add(e.u)).map(e => e.u);
  const nb = u => repsOf(u).filter(e => S.days.has(e.d)).length;
  if(SW.order === 'rare') l.sort((a,b) => nb(a)-nb(b));   // les plus rares d'abord : ils contraignent le planning
  else if(SW.order === 'alea') l.sort(() => Math.random()-.5);
  SW.list = l; SW.k = 0; SW.hist = [];
}
function drawFilterBar(){
  const chip = (l,on,ds) => `<span class="chip${on?' on':''}" ${ds}>${esc(l)}</span>`;
  $('fCats').innerHTML  = CATS.map(c => chip(c, S.extra.has(c), `data-x="${c}"`)).join(' ');
  $('fTypes').innerHTML = TYPES.map(t => chip(t, S.types.has(t), `data-t="${esc(t)}" style="border-color:${HUE[t]}"`)).join(' ');
  $('fReps').innerHTML  = REPS.map(r => chip(r, S.extra.has(r), `data-x="${r}"`)).join(' ');
  $('fDur').value = SW.dur; $('fJauge').value = SW.jauge; $('fOrder').value = SW.order;
  const tot = new Set(E.filter(e => S.days.has(e.d)).map(e => e.u)).size;
  const classes = [...S.rank.keys()].length;
  $('fCount').textContent = `${SW.list.length} à trier · ${classes}/${tot} déjà classés`;
}
function drawSwipe(){
  const done = SW.k >= SW.list.length;
  $('swFoot').style.display = done ? 'none' : '';
  $('swImg').style.display  = done ? 'none' : '';
  if(done){
    const c = $('swCard'); c.style.transform=''; c.style.opacity=1; $('swStamp').style.opacity=0;
    $('swTitle').textContent = SW.list.length ? 'Tout est trié !' : 'Aucun spectacle à trier ici';
    $('swCie').textContent=''; $('swSub').textContent=''; $('swTags').innerHTML='';
    $('swDesc').textContent = SW.list.length
      ? 'Passe à l’étape 2 pour revoir tes choix, puis génère ton planning.'
      : 'Élargis les filtres ci-dessus, coche davantage de jours de présence, ou passe à l’étape suivante.';
    $('swSeances').innerHTML=''; $('swCount').textContent='';
    $('swLinks').innerHTML = `<button class="btn primary" onclick="go('review')">Voir mes envies →</button>`;
    return;
  }
  const u = SW.list[SW.k], s = SH[u] || {}, reps = repsOf(u), e0 = reps[0];
  const c = $('swCard'); c.style.transform=''; c.style.opacity=1; $('swStamp').style.opacity=0;
  $('swImg').src = s.img || ''; $('swImg').style.display = s.img ? 'block' : 'none';
  $('swTitle').textContent = e0.t;
  $('swCie').textContent   = e0.c;
  $('swSub').textContent   = s.sub || '';
  const rp = [...new Set(reps.flatMap(e => e.rp))];
  $('swTags').innerHTML =
      e0.ty.map(t => `<span class="tag" style="background:${HUE[t]};color:#fff;font-weight:600">${esc(t)}</span>`).join('')
    + (e0.ca.includes('In') ? '<span class="tag in">SÉLECTION IN</span>' : '<span class="tag">Sélection Off</span>')
    + `<span class="tag">${esc(e0.dt)}</span>`
    + (e0.j ? `<span class="tag ${e0.j<=100?'j1':e0.j<=200?'j2':''}">jauge ${e0.j}</span>` : '')
    + (s.age ? `<span class="tag">${esc(s.age)}</span>` : '')
    + rp.map(x => `<span class="tag">${esc(x)}</span>`).join('')
    + (e0.w ? '<span class="tag free">⟳ passage libre</span>' : '');
  $('swDesc').textContent = s.desc || '(pas de description sur le site)';
  const dispo = reps.filter(e => S.days.has(e.d));
  $('swSeances').innerHTML = `<b>${dispo.length} séance${dispo.length>1?'s':''}</b> sur tes jours de présence`
    + (e0.j && !e0.w ? ` · à cette jauge, arriver <b>${dur(avance(e0))}</b> avant` : '') + ' :<br>'
    + DAYS.filter(d => S.days.has(d)).map(d => {
        const l = dispo.filter(e => e.d === d);
        return l.length ? `${DAYNAME[d]} : ${l.map(e => fmt(e.s)).join(', ')} — 📍${esc(venueLine(l[0]))}` : '';
      }).filter(Boolean).join('<br>');
  $('swLinks').innerHTML =
      `<a class="btn sm" href="${u}" target="_blank" rel="noopener">Fiche complète ↗</a>`
    + (s.vid ? ` <a class="btn sm" href="${s.vid}" target="_blank" rel="noopener">▶ Vidéo</a>` : '')
    + (s.web ? ` <a class="btn sm" href="${s.web}" target="_blank" rel="noopener">Site de la cie ↗</a>` : '');
  $('swBody').scrollTop = 0;
  $('swCount').textContent = `${SW.k+1} / ${SW.list.length}`;
}
function decide(v){                                   // 3 | 2 | 1 | -1 | 'skip'
  if(SW.busy || SW.k >= SW.list.length) return;       // une décision à la fois : sinon deux
  const u = SW.list[SW.k];                            // touches rapprochées classent la même fiche
  SW.hist.push({u, prev:rk(u)});
  if(v !== 'skip') setRank(u, v);
  const c = $('swCard');
  if(v === 'skip'){ SW.k++; drawSwipe(); drawFilterBar(); return }
  SW.busy = true;
  const st = $('swStamp'), L = LV[v];
  st.textContent = L.ico + ' ' + L.short.toUpperCase();
  st.style.background = L.col;
  st.style.opacity = 1;
  c.style.transition = 'transform .22s ease-out, opacity .22s';
  c.style.transform = v === -1 ? 'translateX(-520px) rotate(-13deg)'
                    : v === 1  ? 'translateY(-360px) scale(.92)'
                    : `translateX(520px) rotate(13deg)`;
  c.style.opacity = 0;
  setTimeout(() => {SW.busy = false; c.style.transition=''; SW.k++; drawSwipe(); drawFilterBar()}, 200);
}
function undoSwipe(){
  SW.busy = false;
  if(!SW.hist.length) return;
  const h = SW.hist.pop();
  setRank(h.u, h.prev);
  SW.k = Math.max(0, SW.k-1);
  drawSwipe(); drawFilterBar();
}
$('swMust').onclick  = () => decide(3);
$('swWant').onclick  = () => decide(2);
$('swMaybe').onclick = () => decide(1);
$('swNo').onclick    = () => decide(-1);
$('swSkip').onclick  = () => decide('skip');
$('swBack').onclick  = undoSwipe;
addEventListener('keydown', ev => {
  if(S.step !== 'discover' || SW.k >= SW.list.length) return;
  if(ev.target.matches('input,select,textarea')) return;
  const k = ev.key;
  if(k === 'ArrowRight') decide(2);
  else if(k === 'ArrowLeft') decide(-1);
  else if(k === 'ArrowUp'){ ev.preventDefault(); decide(3) }
  else if(k === 'ArrowDown'){ ev.preventDefault(); decide(1) }
  else if(k === ' '){ ev.preventDefault(); decide('skip') }
  else if(k === 'Backspace'){ ev.preventDefault(); undoSwipe() }
});
// glisser : droite ♥ · gauche ✕ · haut ★ · bas ?
(() => {
  const c = $('swCard'); let x0=null, y0=0, dx=0, dy=0;
  c.addEventListener('pointerdown', e => {
    if(e.target.closest('button,a,#swBody')) return;
    x0=e.clientX; y0=e.clientY; dx=dy=0; c.setPointerCapture(e.pointerId); c.style.transition='';
  });
  c.addEventListener('pointermove', e => {
    if(x0 === null) return;
    dx = e.clientX-x0; dy = e.clientY-y0;
    const vert = Math.abs(dy) > Math.abs(dx);
    const v = vert ? (dy<0 ? 3 : 1) : (dx>0 ? 2 : -1);
    const amt = vert ? Math.abs(dy) : Math.abs(dx);
    c.style.transform = vert ? `translateY(${dy}px)` : `translateX(${dx}px) rotate(${dx/28}deg)`;
    const st = $('swStamp'), L = LV[v];
    st.textContent = L.ico+' '+L.short.toUpperCase();
    st.style.background = L.col; st.style.opacity = Math.min(1, amt/110);
  });
  c.addEventListener('pointerup', () => {
    if(x0 === null) return;
    const X=dx, Y=dy; x0=null;
    const vert = Math.abs(Y) > Math.abs(X);
    if(vert && Math.abs(Y) > 110) decide(Y<0 ? 3 : 1);
    else if(!vert && Math.abs(X) > 110) decide(X>0 ? 2 : -1);
    else { c.style.transition='transform .18s'; c.style.transform=''; $('swStamp').style.opacity=0 }
  });
})();
$('fToggle').onclick = () => $('fPanel').classList.toggle('open');
$('fPanel').onclick = ev => {
  const c = ev.target.closest('.chip'); if(!c) return;
  ev.stopPropagation();
  if(c.id === 'fClear'){ S.types.clear(); S.extra.clear(); SW.dur = SW.jauge = 0 }
  else if(c.dataset.t) S.types.has(c.dataset.t) ? S.types.delete(c.dataset.t) : S.types.add(c.dataset.t);
  else if(c.dataset.x) S.extra.has(c.dataset.x) ? S.extra.delete(c.dataset.x) : S.extra.add(c.dataset.x);
  else return;
  buildSwipeList(); drawFilterBar(); drawSwipe();
};
$('fDur').onchange   = e => {SW.dur=+e.target.value;   buildSwipeList(); drawFilterBar(); drawSwipe()};
$('fJauge').onchange = e => {SW.jauge=+e.target.value; buildSwipeList(); drawFilterBar(); drawSwipe()};
$('fOrder').onchange = e => {SW.order=e.target.value;  buildSwipeList(); drawFilterBar(); drawSwipe()};

// ---------------------------------------------------------------- étape 2 : mes envies
function rankWidget(u){
  return `<span class="rank" data-u="${esc(u)}">`
    + [3,2,1,-1].map(v => `<button data-r="${v}" class="${rk(u)===v?'on':''}" title="${LV[v].lbl}">${LV[v].ico}</button>`).join('')
    + `</span>`;
}
function drawReview(){
  const q = S.q.toLowerCase();
  const shows = [...new Set(E.map(e => e.u))].map(u => {
    const reps = repsOf(u), e0 = reps[0];
    return {u, e0, reps, dispo:reps.filter(e => S.days.has(e.d)).length};
  }).filter(s => !q || (s.e0.t+' '+s.e0.c).toLowerCase().includes(q));

  const groups = [3,2,1].concat(S.revNone?[0]:[]).concat(S.revNo?[-1]:[]);
  let html = '';
  for(const g of groups){
    const list = shows.filter(s => rk(s.u) === g).sort((a,b) => a.e0.t.localeCompare(b.e0.t));
    if(!list.length && g !== 0) { if(g>0) html += emptyGroup(g); continue }
    if(!list.length) continue;
    html += `<div class="revgroup"><div class="revhead">
        <span class="dot" style="background:${LV[g].col}"></span>
        <h2>${LV[g].ico} ${LV[g].lbl}</h2><span class="muted">${list.length}</span></div>
      <div class="revgrid">` + list.map(s => rcard(s)).join('') + `</div></div>`;
  }
  const nNone = shows.filter(s => !rk(s.u)).length;
  if(!S.revNone && nNone) html += `<p class="muted" style="font-size:12.5px">${nNone} spectacle(s) pas encore classé(s) — <a href="#" id="lnkDiscover">continuer la découverte</a> ou <a href="#" id="lnkShowNone">les afficher ici</a>.</p>`;
  $('revBody').innerHTML = html || '<p class="muted">Aucun spectacle ne correspond.</p>';
  const a = $('lnkDiscover'); if(a) a.onclick = e => {e.preventDefault(); go('discover')};
  const b = $('lnkShowNone'); if(b) b.onclick = e => {e.preventDefault(); S.revNone=true; drawReview(); syncChips()};
}
const emptyGroup = g => `<div class="revgroup"><div class="revhead">
    <span class="dot" style="background:${LV[g].col}"></span><h2>${LV[g].ico} ${LV[g].lbl}</h2>
    <span class="muted">0</span></div>
  <p class="muted" style="font-size:12.5px;margin:0">Rien pour l’instant.</p></div>`;
function rcard(s){
  const {u, e0, dispo} = s, sh = SH[u] || {};
  return `<div class="rcard">
    ${sh.img ? `<img src="${sh.img}" alt="" loading="lazy">` : ''}
    <div class="meta">
      <b><a href="${u}" target="_blank" rel="noopener">${esc(e0.t)}</a></b>
      <div class="cie">${esc(e0.c)}</div>
      <div class="tags">
        ${e0.ty.map(t=>`<span class="tag" style="background:${HUE[t]};color:#fff">${esc(t)}</span>`).join('')}
        ${e0.ca.includes('In')?'<span class="tag in">IN</span>':''}
        <span class="tag">${esc(e0.dt)}</span>
        ${e0.j?`<span class="tag ${e0.j<=100?'j1':e0.j<=200?'j2':''}">jauge ${e0.j}</span>`:''}
        <span class="tag ${dispo<=1?'rare':''}">${dispo} séance${dispo>1?'s':''}</span>
      </div>
      ${rankWidget(u)}
    </div></div>`;
}
$('revBody').addEventListener('click', ev => {
  const b = ev.target.closest('.rank button'); if(!b) return;
  const u = b.closest('.rank').dataset.u, v = +b.dataset.r;
  setRank(u, rk(u) === v ? 0 : v);
  drawReview();
});
$('revQ').oninput = e => {S.q = e.target.value; drawReview()};
$('revShowNone').onclick = () => {S.revNone = !S.revNone; drawReview(); syncChips()};
$('revShowNo').onclick   = () => {S.revNo   = !S.revNo;   drawReview(); syncChips()};

// ---------------------------------------------------------------- étape 3 : planning
$('tabs').innerHTML = DAYS.map(d => `<button data-d="${d}">${DAYNAME[d]}</button>`).join('');
$('presence').innerHTML = DAYS.map(d =>
  `<label style="display:inline-flex;gap:3px;align-items:center;font-size:12.5px;cursor:pointer">
     <input type="checkbox" data-p="${d}" style="accent-color:var(--accent);margin:0"> ${DAYNAME[d].split(' ')[0]}</label>`).join('');
$('presence').onchange = ev => {
  const d = ev.target.dataset.p;
  ev.target.checked ? S.days.add(d) : S.days.delete(d);
  if(!S.days.size){ S.days.add(d); ev.target.checked = true }
  E.forEach(e => {if(!S.days.has(e.d)) S.sel.delete(e.i)});
  save(); render();
};
$('tabs').onclick = ev => {const b = ev.target.closest('button'); if(b){S.day = b.dataset.d; render()}};
$('view').onchange = e => {S.view = e.target.value; render()};
$('hideBlocked').onclick = () => {S.hide = !S.hide; render()};
$('onlyRanked').onclick  = () => {S.onlyRanked = !S.onlyRanked; render()};
$('clearPlan').onclick   = () => {S.sel.clear(); $('report').innerHTML=''; save(); render()};
$('toggleSide').onclick = () => {
  const p = $('planPane');
  if (p.classList.contains('showside')) {
    p.classList.remove('showside');
    $('toggleSide').innerHTML = '📋 Ma sélection';
  } else {
    p.classList.add('showside');
    $('toggleSide').innerHTML = '← Calendrier';
  }
};
$('scroll').onscroll = () => {$('axis').style.transform = 'translateY('+(-$('scroll').scrollTop)+'px)'};

document.addEventListener('click', ev => {
  const ban = ev.target.closest('.evbtn'); if(ban){
    const e = byI.get(+ban.closest('.ev').dataset.i);
    if(ban.dataset.a === 'no') setRank(e.u, rk(e.u) === -1 ? 0 : -1);
    else setRank(e.u, rk(e.u) >= 3 ? 0 : (rk(e.u) || 1) + 1);   // ? → ♥ → ★ → neutre
    render(); return;
  }
  const card = ev.target.closest('#grid .ev, #listView .ev');
  if(card && !ev.target.closest('a')){
    const e = byI.get(+card.dataset.i);
    if(rk(e.u) === -1){ setRank(e.u, 0); render(); return }
    if(!S.days.has(e.d)) return;
    $('report').innerHTML = '';
    S.sel.has(e.i) ? S.sel.delete(e.i) : S.sel.add(e.i);
    save(); render(); return;
  }
  const add = ev.target.closest('[data-add]');
  if(add){ S.sel.add(+add.dataset.add); $('report').innerHTML=''; save(); render() }
  const rm = ev.target.closest('[data-rm]');
  if(rm){ S.sel.delete(+rm.dataset.rm); $('report').innerHTML=''; save(); render() }
});

function pack(items){
  const lanes = [];
  for(const o of items){
    let k = lanes.findIndex(end => end <= o.e.s);
    if(k < 0){ k = lanes.length; lanes.push(0) }
    lanes[k] = Math.max(o.e.e, o.e.s + MINMIN); o.sub = k;
  }
  return Math.max(1, lanes.length);
}
function card(e, st, rest, style){
  const r = rk(e.u);
  const j = e.j && !e.w ? `<span class="tag ${e.j<=100?'j1':e.j<=200?'j2':''}">jauge ${e.j}</span>` : '';
  const badges = (e.ca.includes('In') ? '<span class="tag in">IN</span>' : '') + j
    + (rest ? `<span class="tag rare">${rest===1?'DERNIÈRE SÉANCE':'PLUS QUE 2 SÉANCES'}</span>` : '')
    + (e.w ? '<span class="tag free">⟳ passage libre</span>' : e.k ? '<span class="tag">en continu</span>' : '');
  const head = e.w ? `ouvert ${fmt(e.s)} → ${fmt(e.e)}` : `${fmt(e.s)}–${fmt(e.e)} · ${esc(e.dt)}`;
  const v = venue(e);
  const tip = esc(`${e.t}\n${e.c}\n${head}\n📍${venueLine(e)}${e.j?`\njauge ${e.j} · arriver ${dur(avance(e))} avant`:''}\n${e.ty.join(', ')}`);
  return `<div class="ev ${st} ${e.w?'win':''} ${r>0?'r'+r:''}" data-i="${e.i}" title="${tip}"
      style="--c:${HUE[e.ty[0]]||'#888'};${style||''}">
    <span class="evbtn b1" data-a="no" title="${rk(e.u)===-1?'Réintégrer':'Pas pour moi'}">${rk(e.u)===-1?'↺':'✕'}</span>
    <span class="evbtn b2" data-a="up" title="Changer mon envie">${r>0?LV[r].ico:'♥'}</span>
    <span class="h">${head}</span>
    <b><a href="${e.u}" target="_blank" rel="noopener">${esc(e.t)}</a></b>
    <i>${esc(e.c)}</i>
    <i>📍${e.p||'?'} ${esc(v.name || v.addr)}</i>
    <span class="badges">${badges}</span>
  </div>`;
}
function syncChips(){
  $('hideBlocked').classList.toggle('on', S.hide);
  $('onlyRanked').classList.toggle('on', S.onlyRanked);
  $('revShowNone').classList.toggle('on', S.revNone);
  $('revShowNo').classList.toggle('on', S.revNo);
}
function render(){
  syncChips();
  document.querySelectorAll('#tabs button').forEach(b => {
    b.classList.toggle('on', b.dataset.d === S.day);
    b.style.opacity = S.days.has(b.dataset.d) ? '' : '.45';
    b.style.textDecoration = S.days.has(b.dataset.d) ? '' : 'line-through';
  });
  document.querySelectorAll('#presence input').forEach(c => c.checked = S.days.has(c.dataset.p));

  const sel = selected();
  const st = new Map(E.map(e => [e.i, status(e, sel)]));
  const alive = {};
  E.forEach(e => {
    if(rk(e.u) === -1) return;
    alive[e.u] = alive[e.u] || 0;
    const s = st.get(e.i); if(s === 'free' || s === 'tight' || s === 'sel') alive[e.u]++;
  });
  const restOf = e => (st.get(e.i)==='free'||st.get(e.i)==='tight') && alive[e.u] <= 2 ? alive[e.u] : 0;

  let evs = E.filter(e => e.d === S.day && passFilters(e)
      && (!S.onlyRanked || rk(e.u) > 0)).map(e => ({e, s:st.get(e.i)}));
  if(S.hide) evs = evs.filter(o => !['blocked','dup','off','no'].includes(o.s));

  const isCal = S.view !== 'list';
  $('cal').style.display = isCal ? 'grid' : 'none';
  $('listView').style.display = isCal ? 'none' : 'block';

  if(isCal){
    const byLieu = S.view === 'lieu';
    const W = byLieu ? 170 : 206, GAP = 6, TOP = byLieu ? 34 : 6;
    const sorted = [...evs].sort((a,b) => a.e.s - b.e.s);
    let head = '', total = 0;
    if(byLieu){
      const groups = new Map();
      for(const o of sorted){ if(!groups.has(o.e.p)) groups.set(o.e.p, []); groups.get(o.e.p).push(o) }
      const lieux = [...groups.keys()].sort((a,b) => ((P[a]||{}).lo ?? 9) - ((P[b]||{}).lo ?? 9)); // ouest → est
      for(const p of lieux){
        const items = groups.get(p), n = pack(items), w = n*W, pt = P[p] || {};
        items.forEach(o => {o.x = total + o.sub*W; o.w = W-GAP});
        head += `<div class="hcell" style="left:${total}px;width:${w-GAP}px" title="${esc(pt.a||'')}"><b>${p||'?'}</b> ${esc(pt.n||'')}</div>`;
        total += w;
      }
    } else {
      total = pack(sorted) * W;
      sorted.forEach(o => {o.x = o.sub*W; o.w = W-GAP});
    }
    let html = '', ax = '';
    for(let m = T0; m <= T1; m += 30) html += `<div class="hr ${m%60?'half':''}" style="top:${TOP+(m-T0)*PX}px"></div>`;
    for(let m = T0; m <= T1; m += 60) ax += `<div class="t" style="top:${TOP+(m-T0)*PX}px">${fmt(m)}</div>`;
    $('axis').innerHTML = ax;
    for(const o of sorted){
      const top = TOP + (o.e.s-T0)*PX, h = Math.max((o.e.e-o.e.s)*PX - 3, MINH);
      html += card(o.e, o.s, restOf(o.e), `left:${o.x}px;width:${o.w}px;top:${top}px;height:${h}px`);
    }
    $('head').innerHTML = head;
    $('grid').innerHTML = html;
    $('grid').style.width  = Math.max(total, 300)+'px';
    $('grid').style.height = $('axis').style.height = TOP + (T1-T0)*PX + 70 + 'px';
  } else {
    $('listView').innerHTML = evs.length
      ? evs.sort((a,b) => a.e.s-b.e.s).map(o => card(o.e, o.s, restOf(o.e))).join('')
      : '<p class="muted">Rien ne correspond aux filtres.</p>';
  }

  const free = evs.filter(o => o.s === 'free').length, tight = evs.filter(o => o.s === 'tight').length;
  const spec = Object.values(alive), open = spec.filter(n => n>0).length;
  const nRank = [...S.rank.values()];
  $('stat').textContent =
      `${evs.length} représentations${S.days.has(S.day)?'':' — jour non retenu'} · ${free} compatibles`
    + (tight ? ` · ${tight} serrées` : '')
    + ` · ${open}/${spec.length} spectacles encore accessibles`
    + ` · ★ ${nRank.filter(v=>v===3).length} ♥ ${nRank.filter(v=>v===2).length} ? ${nRank.filter(v=>v===1).length} ✕ ${nRank.filter(v=>v===-1).length}`;

  drawSide(sel);
  $('legend').innerHTML = `Écart nécessaire = <b>temps de marche</b> + <b>avance selon la jauge</b>
    (${TIERS.map(t=>`${t.lbl.replace('Jauge ','')} : ${dur(S.marges[t.id])}`).join(' · ')}), réglable dans ⚙︎.<br>
    <span style="color:var(--ok)">■</span> ça passe &nbsp;
    <span style="color:var(--warn)">■</span> serré, tu arrives après l’heure conseillée &nbsp;
    <span style="color:var(--bad)">■</span> impossible.`;
}

/* Suggestions à glisser dans un trou.
   On propose d'abord les spectacles classés (★ ♥ ?) que la génération n'a pas pu caser,
   puis les non classés — jamais ceux marqués « pas pour moi ».
   Une suggestion n'est retenue que si l'aller ET le retour tiennent dans l'horaire. */
function suggestions(a, b, day, max = 3){
  const inPlan = new Set([...S.sel].map(i => byI.get(i).u));
  return E.filter(c => c.d === day && !c.w && rk(c.u) >= 0 && !inPlan.has(c.u) && !S.sel.has(c.i))
    .map(c => {
      const la = a ? link(a, c) : null, lb = b ? link(c, b) : null;
      if((la && la.lvl === 'bad') || (lb && lb.lvl === 'bad')) return null;
      const tight = (la && la.lvl === 'warn') || (lb && lb.lvl === 'warn');
      return {c, la, lb, tight};
    }).filter(Boolean)
    .sort((x,y) => rk(y.c.u) - rk(x.c.u) || (x.tight - y.tight) || (x.c.s - y.c.s))
    .filter((o,i,arr) => arr.findIndex(z => z.c.u === o.c.u) === i)
    .slice(0, max);
}
function suggBlock(a, b, day, label){
  const list = suggestions(a, b, day);
  if(!list.length) return '';
  const nRanked = list.filter(o => rk(o.c.u) > 0).length;
  return `<details class="sugg"><summary>${list.length} suggestion${list.length>1?'s':''} ${label}`
    + (nRanked ? ` <span class="muted">(dont ${nRanked} dans tes envies)</span>` : '')
    + `</summary>`
    + list.map(o => {
        const e = o.c, r = rk(e.u);
        return `<div class="sitem">
          <b>${r>0?LV[r].ico:'·'} <a href="${e.u}" target="_blank" rel="noopener">${esc(e.t)}</a></b>
          <small>${fmt(e.s)}–${fmt(e.e)} · ${esc(e.c)} · ${r>0?LV[r].short:'non classé'}<br>
            📍${e.p} ${esc(venueLine(e))}
            ${o.la?` · 🚶 ${o.la.walk} min pour y aller`:''}${o.lb?` · 🚶 ${o.lb.walk} min pour repartir`:''}
            ${o.tight?' · <span style="color:var(--warn)">serré</span>':''}</small>
          <button class="btn sm" data-add="${e.i}">+ Ajouter</button></div>`;
      }).join('') + `</details>`;
}

// -------- panneau Ma sélection --------
function drawSide(sel){
  $('count').textContent = sel.length ? `(${sel.length})` : '';
  if(!sel.length){
    $('alerts').innerHTML = '';
    $('picks').innerHTML = `<p class="muted" style="font-size:12.5px">Rien pour l’instant.<br>
      Clique un spectacle dans le calendrier, ou lance <b>⚡ Générer</b> pour construire automatiquement
      ton planning à partir de tes envies.</p>`;
    return;
  }
  // alertes : tous les couples incompatibles, pas seulement les voisins
  const bad = [];
  for(let i=0;i<sel.length;i++) for(let j=i+1;j<sel.length;j++){
    const a=sel[i], b=sel[j];
    if(a.d !== b.d || a.w || b.w) continue;
    const [x,y] = a.s <= b.s ? [a,b] : [b,a];
    const L = link(x,y);
    if(L.lvl === 'bad') bad.push({x, y, L});
  }
  $('alerts').innerHTML = bad.map(({x,y,L}) => `<div class="alert">
      <b>⚠ Impossible : « ${esc(x.t)} » et « ${esc(y.t)} »</b>
      ${L.overlap != null
        ? `Les deux se chevauchent de ${dur(L.overlap)} (${DAYNAME[x.d]} ${fmt(x.s)}–${fmt(x.e)} et ${fmt(y.s)}–${fmt(y.e)}).`
        : `Il faut ${L.walk} min de marche : en partant à ${fmt(x.e)} tu arrives à ${fmt(x.e+L.walk)}, soit ${dur(L.short)} après le début.`}
      <div style="margin-top:6px;display:flex;gap:6px">
        <button class="btn sm" data-rm="${x.i}">Retirer « ${esc(x.t.slice(0,22))}… »</button>
        <button class="btn sm" data-rm="${y.i}">Retirer « ${esc(y.t.slice(0,22))}… »</button>
      </div></div>`).join('');

  let out = '', prev = null;
  sel.forEach((e, idx) => {
    const nextSameDay = sel[idx+1] && sel[idx+1].d === e.d ? sel[idx+1] : null;
    if(!prev || prev.d !== e.d){
      out += `<div class="daysep">${DAYLONG[e.d]}</div>`;
      prev = null;
      out += suggBlock(null, e, e.d, 'avant celui-ci');
    }
    if(prev){
      const L = link(prev, e);
      if(L.lvl === 'free'){
        out += `<div class="leg">⟳ passage libre : pas de contrainte · 🚶 ${L.walk} min entre les deux lieux</div>`;
      } else {
        const gap = e.s - prev.e;
        out += `<div class="leg ${L.lvl}">`
          + `🚶 <span class="k">${L.walk} min</span> de marche · ⏱ arriver <span class="k">${dur(avance(e))}</span> avant (jauge ${e.j||'?'})<br>`
          + (L.lvl === 'ok'
              ? `<span class="k">${dur(gap)}</span> disponibles → <span class="k">${dur(L.slack)}</span> de battement réel<br>départ conseillé <span class="k">${fmt(L.dep)}</span>`
              : L.lvl === 'warn'
              ? `Serré : tu arrives à ${fmt(L.arr)}, soit ${dur(L.late)} après l’heure conseillée — mais avant le début (${fmt(e.s)}). Pars dès la fin, à ${fmt(L.dep)}.`
              : L.overlap != null
              ? `<b>Impossible</b> : les deux se chevauchent de ${dur(L.overlap)}.`
              : `<b>Impossible</b> : tu arrives à ${fmt(prev.e + L.walk)}, soit ${dur(L.short)} après le début.`)
          + `</div>`;
        if(L.lvl === 'ok' && L.slack >= 30) out += suggBlock(prev, e, e.d, `dans ce trou de ${dur(L.slack)}`);
      }
    }
    const v = venue(e);
    out += `<div class="pick" style="--c:${HUE[e.ty[0]]||'#888'}">
      <span class="x" data-rm="${e.i}" title="Retirer">×</span>
      <b><a href="${e.u}" target="_blank" rel="noopener">${esc(e.t)}</a></b>
      <small>${fmt(e.s)}–${fmt(e.e)} · ${esc(e.c)}</small>
      <small>📍 <span class="venue">${esc(v.name)}</span>${v.addr && v.addr!==v.name ? ` — ${esc(v.addr)}` : ''}
        ${v.lat ? `<a href="https://www.google.com/maps/search/?api=1&query=${v.lat},${v.lon}" target="_blank" rel="noopener">(carte)</a>` : ''}
        · pastille ${e.p}</small>
      ${e.j ? `<small>Jauge ${e.j} · arriver vers <b>${fmt(e.s-avance(e))}</b></small>` : ''}</div>`;
    if(!nextSameDay) out += suggBlock(e, null, e.d, 'après celui-ci');
    prev = e;
  });
  $('picks').innerHTML = out;
}

// -------- génération automatique --------
function buildPlan(){
  const locked = [...S.sel].map(i => byI.get(i)).filter(e => S.days.has(e.d));
  const lockedU = new Set(locked.map(e => e.u));
  const pool = lv => E.filter(e => rk(e.u) === lv && S.days.has(e.d) && !lockedU.has(e.u));
  const tiers = [pool(3), pool(2), pool(1)];               // ★ puis ♥ puis ?
  if(!tiers.some(t => t.length) && !locked.length){
    $('report').innerHTML = `<b>Aucune envie enregistrée.</b><br>
      Passe par <a href="#" onclick="go('discover');return false">l’étape 1</a> pour trier les spectacles,
      puis reviens générer ton planning.`;
    return;
  }
  const fits = (plan, c) => plan.filter(p => p.d === c.d && !p.w)
    .every(p => {const [a,b] = p.s <= c.s ? [p,c] : [c,p]; return link(a,b).lvl !== 'bad'});
  const run = noise => {
    const plan = [...locked], taken = new Set(lockedU);
    for(const tier of tiers){
      const jit = e => e.e + (noise ? (Math.random()-.5)*noise : 0);
      for(const c of [...tier.filter(e => !e.w)].sort((a,b) => jit(a)-jit(b)))
        if(!taken.has(c.u) && fits(plan, c)){ plan.push(c); taken.add(c.u) }
      for(const c of tier.filter(e => e.w))
        if(!taken.has(c.u)){ plan.push(c); taken.add(c.u) }
    }
    return plan;
  };
  const score = p => p.filter(e => rk(e.u) === 3).length*1e6
                   + p.filter(e => rk(e.u) === 2).length*1e3
                   + p.filter(e => rk(e.u) === 1).length;
  let best = run(0);
  for(let t = 0; t < 400; t++){ const p = run(90); if(score(p) > score(best)) best = p }

  S.sel = new Set(best.map(e => e.i));
  const placed = new Set(best.map(e => e.u));
  const cnt = lv => [...S.rank].filter(([u,v]) => v === lv).length;
  const ok  = lv => [...S.rank].filter(([u,v]) => v === lv && placed.has(u)).length;
  const missed = [...S.rank].filter(([u,v]) => v === 3 && !placed.has(u)).map(([u]) => u);
  const noDay  = missed.filter(u => !E.some(e => e.u === u && S.days.has(e.d)));
  save(); render();
  $('report').innerHTML =
      `<b>${best.length} séances</b> sur ${S.days.size} jour${S.days.size>1?'s':''} —
       ★ ${ok(3)}/${cnt(3)} · ♥ ${ok(2)}/${cnt(2)} · ? ${ok(1)}/${cnt(1)}`
    + (missed.length
        ? `<br><span class="muted">★ non casés : ${missed.map(u => esc((E.find(e => e.u === u)||{}).t || '?')).join(', ')}.`
          + (noDay.length ? ` Dont ${noDay.length} qui ne jouent pas sur tes jours.` : '')
          + ` Réduis l’avance demandée dans ⚙︎ pour en récupérer.</span>`
        : '')
    + `<br><span class="muted">Ajuste ensuite à la main : tes clics restent prioritaires à la prochaine génération.</span>`;

  $('planPane').classList.add('showside');
  $('toggleSide').innerHTML = '← Calendrier';
}
$('build').onclick = buildPlan;

// ---------------------------------------------------------------- réglages
function drawSettings(){
  $('setTiers').innerHTML = TIERS.map(t => `<div class="setrow">
      <div class="n">${t.lbl}<small>${t.hint || 'arriver en avance pour avoir une place'}</small></div>
      <select class="sel" data-tier="${t.id}">
        ${MARGE_OPTS.map(v => `<option value="${v}" ${S.marges[t.id]===v?'selected':''}>${v?dur(v):'à l’heure'}</option>`).join('')}
      </select></div>`).join('');
  $('setSpeed').value = S.speed;
}
$('setTiers').onchange = e => {
  const t = e.target.dataset.tier; if(!t) return;
  S.marges[t] = +e.target.value; save(); render();
};
$('setSpeed').onchange = e => {S.speed = +e.target.value; save(); render()};
$('setDefaults').onclick = () => {
  TIERS.forEach(t => S.marges[t.id] = t.def); S.speed = 4.2;
  save(); drawSettings(); render();
};
$('resetAll').onclick = () => {
  if(!confirm('Effacer toutes tes envies, ton planning et tes réglages ?')) return;
  S.rank.clear(); S.sel.clear(); S.days = new Set(DAYS);
  TIERS.forEach(t => S.marges[t.id] = t.def); S.speed = 4.2;
  save(); drawSettings(); go('discover'); render();
};
const openSet  = () => {drawSettings(); $('settings').classList.add('on')};
const closeSet = () => $('settings').classList.remove('on');
$('openSettings').onclick = openSet;
$('openSettings2').onclick = openSet;
$('closeSettings').onclick = closeSet;
$('settings').onclick = e => {if(e.target.id === 'settings') closeSet()};

// ---------------------------------------------------------------- démarrage
window.APP = {S, SW, LV, TIERS, link, avance, walk, status, selected, suggestions, buildPlan, render, go, save, load, setRank, rk, fmt, dur, venue, venueLine, byI, repsOf, drawSwipe, drawReview, drawFilterBar, buildSwipeList, decide, undoSwipe};
load();
render();
go(S.rank.size ? (S.sel.size ? 'plan' : 'review') : 'discover');
