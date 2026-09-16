// --- Clé secrète : lue dans l'URL (?key=xxxx). Si absente, on en génère une
// et on redirige dessus. C'est cette clé qui isole tes données de celles
// de n'importe qui d'autre qui utiliserait le même site.
function getOrCreateKey() {
  const params = new URLSearchParams(window.location.search);
  let key = params.get('key');
  if (!key) {
    key = Array.from(crypto.getRandomValues(new Uint8Array(12)))
      .map(b => b.toString(36)).join('').slice(0, 16);
    params.set('key', key);
    window.location.search = params.toString();
    return null; // la page va recharger
  }
  return key;
}

const SECRET = getOrCreateKey();

let rubriques = [];
let plats = [];               // TOUS les plats du site (filtrés côté client)
let view = { type: 'all', id: null }; // 'all' | 'rubrique' | 'appareil'
let currentStatut = 'envie';
let currentNote = null;       // note en cours d'édition dans le formulaire plat (0 à 5, pas de 0.5)
let searchText = '';
let maxPrice = null;

// --- Mode courses ---
let coursesSelection = new Set();
let coursesGenerated = false;
let coursesList = [];
let coursesChecked = new Set();
let coursesSearch = '';

if (SECRET) {
  document.getElementById('key-banner').style.display = 'block';
  document.getElementById('key-banner').innerHTML =
    `Ton URL personnelle (garde-la précieusement, c'est ta seule clé d'accès) :<br><code>${window.location.href}</code>`;
  init();
}

function siteRef() {
  return db.collection('sites').doc(SECRET);
}

async function init() {
  bindStaticEvents();
  initSidebarCollapse();
  await loadRubriques();
  await loadPlats();
  document.getElementById('status-msg').style.display = 'none';
  document.getElementById('app').style.display = 'block';
}

function bindStaticEvents() {
  document.getElementById('btn-add-plat').onclick = () => openPlatModal(null);
  document.getElementById('btn-toggle-sidebar').onclick = toggleSidebar;
  document.getElementById('sidebar-overlay').onclick = () => {
    document.getElementById('sidebar').classList.add('collapsed');
    localStorage.setItem('sidebar-collapsed', '1');
  };
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.onclick = () => switchTab(btn.dataset.tab);
  });
  document.getElementById('search-input').oninput = (e) => {
    searchText = e.target.value;
    renderPlats();
  };
  document.getElementById('search-maxprice').oninput = (e) => {
    const v = parseFloat(e.target.value);
    maxPrice = isNaN(v) ? null : v;
    renderPlats();
  };
  document.getElementById('btn-add-ingredient').onclick = () => addIngredientRow();
  document.getElementById('courses-search').oninput = (e) => {
    coursesSearch = e.target.value;
    renderCoursesSelection();
  };
  document.getElementById('btn-courses-generate').onclick = generateCoursesList;
  document.getElementById('btn-courses-restart').onclick = restartCourses;
}

// =========================================================
// SIDEBAR RÉTRACTABLE (persistée, comme un panneau de chat)
// =========================================================
function initSidebarCollapse() {
  const collapsed = localStorage.getItem('sidebar-collapsed') === '1';
  document.getElementById('sidebar').classList.toggle('collapsed', collapsed);
}

function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  const collapsed = sidebar.classList.toggle('collapsed');
  localStorage.setItem('sidebar-collapsed', collapsed ? '1' : '0');
}

// =========================================================
// TABS
// =========================================================
function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.getElementById('tab-carnet').classList.toggle('hidden', tab !== 'carnet');
  document.getElementById('tab-courses').classList.toggle('hidden', tab !== 'courses');
  if (tab === 'courses') {
    if (!coursesGenerated) renderCoursesSelection();
    else renderCoursesResult();
  }
}

// =========================================================
// RUBRIQUES + SIDEBAR
// =========================================================
async function loadRubriques() {
  const snap = await siteRef().collection('rubriques').orderBy('nom').get();
  rubriques = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  renderSidebar();
}

function renderSidebar() {
  const allItem = document.getElementById('sidebar-all');
  allItem.innerHTML = '';
  allItem.appendChild(sidebarItem('Tous les plats', plats.length, view.type === 'all', () => setView('all', null)));

  const rubEl = document.getElementById('sidebar-rubriques');
  rubEl.innerHTML = '';
  rubriques.forEach(r => {
    const count = plats.filter(p => p.rubriqueId === r.id).length;
    const item = sidebarItem(r.nom, count, view.type === 'rubrique' && view.id === r.id, () => setView('rubrique', r.id));
    const delBtn = document.createElement('button');
    delBtn.className = 'sidebar-del';
    delBtn.textContent = '×';
    delBtn.onclick = (e) => { e.stopPropagation(); deleteRubrique(r.id); };
    item.appendChild(delBtn);
    rubEl.appendChild(item);
  });

  const apEl = document.getElementById('sidebar-appareils');
  apEl.innerHTML = '';
  APPAREILS.forEach(a => {
    const count = plats.filter(p => (p.appareils || []).includes(a.id)).length;
    apEl.appendChild(sidebarItem(a.label, count, view.type === 'appareil' && view.id === a.id, () => setView('appareil', a.id)));
  });

  populateRubriqueSelect();
}

function sidebarItem(label, count, active, onClick) {
  const div = document.createElement('div');
  div.className = 'sidebar-item' + (active ? ' active' : '');
  div.innerHTML = `<span>${escapeHtml(label)}</span><span class="sidebar-count">${count}</span>`;
  div.onclick = () => {
    onClick();
    if (window.innerWidth <= 760) {
      document.getElementById('sidebar').classList.add('collapsed');
      localStorage.setItem('sidebar-collapsed', '1');
    }
  };
  return div;
}

function setView(type, id) {
  view = { type, id };
  renderSidebar();
  renderPlats();
}

function saveRubrique() {
  const nom = document.getElementById('input-rub-nom').value.trim();
  if (!nom) return;
  siteRef().collection('rubriques').add({ nom }).then(async () => {
    document.getElementById('input-rub-nom').value = '';
    closeOverlay('overlay-rub');
    await loadRubriques();
  });
}

function deleteRubrique(id) {
  if (!confirm('Supprimer cette rubrique ? Les plats à l\'intérieur resteront mais ne seront plus rangés dedans.')) return;
  siteRef().collection('rubriques').doc(id).delete().then(async () => {
    if (view.type === 'rubrique' && view.id === id) view = { type: 'all', id: null };
    await loadRubriques();
    renderPlats();
  });
}

// =========================================================
// PLATS — chargement, filtrage, affichage
// =========================================================
async function loadPlats() {
  const snap = await siteRef().collection('plats').get();
  plats = snap.docs.map(d => normalizePlat(d));
  renderSidebar();
  renderPlats();
}

function normalizeIngredients(raw) {
  if (Array.isArray(raw)) {
    return raw.map(i => ({
      nom: (i.nom || '').trim(),
      quantite: typeof i.quantite === 'number' && !isNaN(i.quantite) ? i.quantite : null,
      unite: i.unite || null,
      courses: i.courses !== false
    })).filter(i => i.nom);
  }
  if (typeof raw === 'string') {
    return raw.split('\n').map(s => s.trim()).filter(Boolean).map(nom => ({ nom, quantite: null, unite: null, courses: true }));
  }
  return [];
}

function normalizePlat(doc) {
  const d = doc.data();
  return {
    id: doc.id,
    nom: d.nom || '',
    rubriqueId: d.rubriqueId || null,
    statut: d.statut || 'envie',
    appareils: Array.isArray(d.appareils) ? d.appareils : [],
    personnes: typeof d.personnes === 'number' ? d.personnes : null,
    prix: typeof d.prix === 'number' ? d.prix : 0,
    ingredients: normalizeIngredients(d.ingredients),
    recette: d.recette || '',
    astuces: d.astuces || '',
    note: typeof d.note === 'number' ? d.note : null,
    commentaires: d.commentaires || ''
  };
}

function filteredPlats() {
  let list = plats.slice();
  if (view.type === 'rubrique') list = list.filter(p => p.rubriqueId === view.id);
  if (view.type === 'appareil') list = list.filter(p => (p.appareils || []).includes(view.id));
  if (searchText.trim()) {
    const q = searchText.trim().toLowerCase();
    list = list.filter(p => p.nom.toLowerCase().includes(q));
  }
  if (maxPrice !== null) list = list.filter(p => (p.prix || 0) <= maxPrice);
  list.sort((a, b) => (a.nom || '').localeCompare(b.nom || ''));
  return list;
}

function viewTitle() {
  if (view.type === 'rubrique') {
    const r = rubriques.find(r => r.id === view.id);
    return r ? r.nom : 'Rubrique';
  }
  if (view.type === 'appareil') {
    const a = APPAREILS.find(a => a.id === view.id);
    return a ? a.label : 'Appareil';
  }
  return 'Tous les plats';
}

function renderPlats() {
  const el = document.getElementById('plats');
  const empty = document.getElementById('empty');
  document.getElementById('rub-title').textContent = viewTitle();

  const list = filteredPlats();
  el.innerHTML = '';
  if (!list.length) { empty.style.display = 'block'; return; }
  empty.style.display = 'none';

  list.forEach(p => {
    const rub = rubriques.find(r => r.id === p.rubriqueId);
    const card = document.createElement('div');
    card.className = 'plat-card';
    card.onclick = () => openDetail(p.id);
    card.innerHTML = `
      <div class="plat-head">
        <div class="plat-nom">${escapeHtml(p.nom)}</div>
        <div class="plat-meta">
          ${p.prix ? `<span class="prix">${Number(p.prix).toFixed(2)} €</span>` : ''}
          <span class="badge ${p.statut === 'fait' ? 'fait' : 'envie'}">${p.statut === 'fait' ? 'Testé' : 'Envie'}</span>
        </div>
      </div>
      ${p.statut === 'fait' && p.note !== null ? `<div class="card-stars">${starsMarkup(p.note, false)}</div>` : ''}
      <div class="plat-tags">
        ${rub && view.type !== 'rubrique' ? `<span class="tag">${escapeHtml(rub.nom)}</span>` : ''}
        ${(p.appareils || []).map(id => {
          const a = APPAREILS.find(x => x.id === id);
          return a ? `<span class="tag tag-appareil">${escapeHtml(a.label)}</span>` : '';
        }).join('')}
        ${p.personnes ? `<span class="tag tag-muted">${p.personnes} pers.</span>` : ''}
      </div>`;
    el.appendChild(card);
  });
}

// =========================================================
// ÉTOILES (notation 0 à 5, demi-étoiles possibles)
// =========================================================
function starsMarkup(value, interactive) {
  value = value || 0;
  let html = '<span class="stars' + (interactive ? ' stars-interactive' : '') + '">';
  for (let i = 1; i <= 5; i++) {
    let fill = 0;
    if (value >= i) fill = 100;
    else if (value >= i - 0.5) fill = 50;
    html += `<span class="star">
      <span class="star-empty">★</span>
      <span class="star-fill" style="width:${fill}%">★</span>
      ${interactive ? `<button type="button" class="star-half star-left" data-value="${i - 0.5}"></button><button type="button" class="star-half star-right" data-value="${i}"></button>` : ''}
    </span>`;
  }
  html += '</span>';
  return html;
}

function renderNoteInput() {
  const el = document.getElementById('plat-stars-input');
  el.innerHTML = starsMarkup(currentNote, true);
  el.querySelectorAll('.star-half').forEach(btn => {
    btn.onclick = () => {
      const v = parseFloat(btn.dataset.value);
      currentNote = (currentNote === v) ? null : v; // recliquer sur la même valeur réinitialise
      renderNoteInput();
    };
  });
  document.getElementById('plat-note-value').textContent = currentNote !== null ? `${currentNote} / 5` : 'Pas encore noté';
}

// =========================================================
// MODALE PLAT — création / édition
// =========================================================
function populateRubriqueSelect() {
  const select = document.getElementById('input-plat-rubrique');
  const current = select.value;
  select.innerHTML = rubriques.map(r => `<option value="${r.id}">${escapeHtml(r.nom)}</option>`).join('');
  if (current) select.value = current;
}

function openPlatModal(plat) {
  if (rubriques.length === 0) {
    alert('Crée d\'abord une rubrique (ex: "à tester") avant d\'ajouter un plat.');
    openOverlay('overlay-rub');
    return;
  }
  populateRubriqueSelect();

  document.getElementById('plat-modal-title').textContent = plat ? 'Modifier le plat' : 'Nouveau plat';
  document.getElementById('plat-id').value = plat ? plat.id : '';
  document.getElementById('input-plat-nom').value = plat ? plat.nom : '';
  document.getElementById('input-plat-recette').value = plat ? plat.recette : '';
  document.getElementById('input-plat-astuces').value = plat ? plat.astuces : '';
  document.getElementById('input-plat-commentaires').value = plat ? plat.commentaires : '';
  document.getElementById('input-plat-prix').value = plat && plat.prix ? plat.prix : '';
  document.getElementById('input-plat-personnes').value = plat && plat.personnes ? plat.personnes : '';
  document.getElementById('btn-delete-plat').style.display = plat ? 'inline-block' : 'none';

  currentNote = plat && plat.note !== null && plat.note !== undefined ? plat.note : null;
  renderNoteInput();
  setStatut(plat ? plat.statut : 'envie');

  document.getElementById('input-plat-rubrique').value = plat ? plat.rubriqueId : (view.type === 'rubrique' ? view.id : rubriques[0].id);

  document.querySelectorAll('#plat-appareils input[type=checkbox]').forEach(cb => {
    cb.checked = plat ? (plat.appareils || []).includes(cb.value) : false;
  });

  document.getElementById('ingredients-rows').innerHTML = '';
  if (plat && plat.ingredients.length) {
    plat.ingredients.forEach(i => addIngredientRow(i.nom, i.quantite, i.unite, i.courses));
  } else {
    addIngredientRow();
  }

  openOverlay('overlay-plat');
}

function setStatut(s) {
  currentStatut = s;
  document.querySelector('.sel-envie').classList.toggle('on', s === 'envie');
  document.querySelector('.sel-fait').classList.toggle('on', s === 'fait');
  document.getElementById('plat-note-section').classList.toggle('hidden', s !== 'fait');
}

function unitesOptionsHtml(selected) {
  let html = `<option value="">—</option>`;
  UNITES.forEach(u => {
    html += `<option value="${u.id}" ${selected === u.id ? 'selected' : ''}>${u.label}</option>`;
  });
  return html;
}

function addIngredientRow(nom = '', quantite = null, unite = null, courses = true) {
  const row = document.createElement('div');
  row.className = 'ingredient-row';
  row.innerHTML = `
    <input type="text" class="ingredient-nom" placeholder="ex: farine" value="${escapeHtml(nom)}">
    <input type="number" class="ingredient-qte" placeholder="qté" step="any" min="0" value="${quantite !== null ? quantite : ''}">
    <select class="ingredient-unite">${unitesOptionsHtml(unite)}</select>
    <label class="ingredient-check">
      <input type="checkbox" class="ingredient-courses" ${courses ? 'checked' : ''}>
      Courses
    </label>
    <button type="button" class="btn-remove-ingredient">×</button>`;
  row.querySelector('.btn-remove-ingredient').onclick = () => row.remove();
  document.getElementById('ingredients-rows').appendChild(row);
}

function savePlat() {
  const nom = document.getElementById('input-plat-nom').value.trim();
  if (!nom) return;

  const appareils = Array.from(document.querySelectorAll('#plat-appareils input[type=checkbox]:checked')).map(cb => cb.value);
  const ingredients = Array.from(document.querySelectorAll('#ingredients-rows .ingredient-row')).map(row => {
    const qteRaw = row.querySelector('.ingredient-qte').value;
    return {
      nom: row.querySelector('.ingredient-nom').value.trim(),
      quantite: qteRaw ? parseFloat(qteRaw) : null,
      unite: row.querySelector('.ingredient-unite').value || null,
      courses: row.querySelector('.ingredient-courses').checked
    };
  }).filter(i => i.nom);
  const personnesRaw = document.getElementById('input-plat-personnes').value;

  const data = {
    rubriqueId: document.getElementById('input-plat-rubrique').value,
    nom,
    statut: currentStatut,
    appareils,
    personnes: personnesRaw ? parseInt(personnesRaw, 10) : null,
    ingredients,
    recette: document.getElementById('input-plat-recette').value.trim(),
    astuces: document.getElementById('input-plat-astuces').value.trim(),
    prix: parseFloat(document.getElementById('input-plat-prix').value) || 0,
    note: currentStatut === 'fait' ? currentNote : null,
    commentaires: currentStatut === 'fait' ? document.getElementById('input-plat-commentaires').value.trim() : ''
  };
  const id = document.getElementById('plat-id').value;
  const col = siteRef().collection('plats');
  const p = id ? col.doc(id).update(data) : col.add(data);
  p.then(async () => { closeOverlay('overlay-plat'); await loadPlats(); });
}

function deletePlat() {
  const id = document.getElementById('plat-id').value;
  if (!id || !confirm('Supprimer ce plat ?')) return;
  siteRef().collection('plats').doc(id).delete().then(async () => {
    closeOverlay('overlay-plat');
    closeOverlay('overlay-detail');
    await loadPlats();
  });
}

// =========================================================
// DÉTAIL D'UN PLAT
// =========================================================
let detailPlatId = null;
function openDetail(id) {
  const p = plats.find(x => x.id === id);
  if (!p) return;
  detailPlatId = id;
  const rub = rubriques.find(r => r.id === p.rubriqueId);

  document.getElementById('detail-nom').textContent = p.nom;
  document.getElementById('detail-statut').textContent = p.statut === 'fait' ? 'Déjà testé' : 'Envie de faire';
  document.getElementById('detail-rubrique').textContent = rub ? rub.nom : '—';
  document.getElementById('detail-personnes').textContent = p.personnes ? p.personnes + ' personnes' : '—';
  document.getElementById('detail-appareils').textContent = (p.appareils || []).length
    ? p.appareils.map(id => (APPAREILS.find(a => a.id === id) || {}).label).filter(Boolean).join(', ')
    : '—';
  document.getElementById('detail-prix').textContent = p.prix ? Number(p.prix).toFixed(2) + ' €' : '—';

  const noteSection = document.getElementById('detail-note-section');
  if (p.statut === 'fait') {
    noteSection.classList.remove('hidden');
    document.getElementById('detail-note').innerHTML = p.note !== null ? starsMarkup(p.note, false) + ` <span class="note-value">${p.note} / 5</span>` : 'Pas encore noté';
    document.getElementById('detail-commentaires').textContent = p.commentaires || '—';
  } else {
    noteSection.classList.add('hidden');
  }

  document.getElementById('detail-recette').textContent = p.recette || '—';
  document.getElementById('detail-astuces').textContent = p.astuces || '—';

  const ingList = document.getElementById('detail-ingredients');
  ingList.innerHTML = p.ingredients.length
    ? p.ingredients.map(i => `<li>${i.courses ? '🛒 ' : ''}${formatIngredientLabel(i)}</li>`).join('')
    : '<li>—</li>';

  openOverlay('overlay-detail');
}

function formatIngredientLabel(i) {
  if (i.quantite !== null && i.quantite !== undefined) {
    return `${formatNum(i.quantite)}${i.unite ? ' ' + uniteLabel(i.unite) : ''} ${escapeHtml(i.nom)}`;
  }
  return escapeHtml(i.nom);
}

function editFromDetail() {
  const p = plats.find(x => x.id === detailPlatId);
  closeOverlay('overlay-detail');
  openPlatModal(p);
}

// =========================================================
// MODE COURSES
// =========================================================
function renderCoursesSelection() {
  document.getElementById('courses-selection').classList.remove('hidden');
  document.getElementById('courses-result').classList.add('hidden');

  const container = document.getElementById('courses-plats-list');
  let list = plats.slice().sort((a, b) => (a.nom || '').localeCompare(b.nom || ''));
  const q = coursesSearch.trim().toLowerCase();
  if (q) list = list.filter(p => p.nom.toLowerCase().includes(q));

  container.innerHTML = '';
  if (!list.length) {
    container.innerHTML = '<p class="empty-inline">Aucun plat enregistré pour l\'instant.</p>';
  } else {
    list.forEach(p => {
      const row = document.createElement('label');
      row.className = 'courses-row';
      row.innerHTML = `
        <input type="checkbox" ${coursesSelection.has(p.id) ? 'checked' : ''}>
        <span>${escapeHtml(p.nom)}</span>
        ${p.prix ? `<span class="prix">${Number(p.prix).toFixed(2)} €</span>` : ''}`;
      row.querySelector('input').onchange = (e) => {
        if (e.target.checked) coursesSelection.add(p.id); else coursesSelection.delete(p.id);
        document.getElementById('btn-courses-generate').disabled = coursesSelection.size === 0;
      };
      container.appendChild(row);
    });
  }
  document.getElementById('btn-courses-generate').disabled = coursesSelection.size === 0;
}

// --- Normalisation + similarité de texte (pas de vraie base d'ingrédients,
// donc on regroupe par nom exact et on trie le reste par ressemblance) ---
function normalizeName(s) {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}

function bigrams(s) {
  const arr = [];
  for (let i = 0; i < s.length - 1; i++) arr.push(s.substring(i, i + 2));
  return arr;
}

function diceCoefficient(a, b) {
  const bgA = bigrams(a), bgB = bigrams(b);
  if (!bgA.length || !bgB.length) return a === b ? 1 : 0;
  const mapB = {};
  bgB.forEach(bg => mapB[bg] = (mapB[bg] || 0) + 1);
  let matches = 0;
  bgA.forEach(bg => { if (mapB[bg] > 0) { matches++; mapB[bg]--; } });
  return (2 * matches) / (bgA.length + bgB.length);
}

function orderBySimilarity(groups) {
  if (groups.length <= 2) return groups.sort((a, b) => a.key.localeCompare(b.key));
  const remaining = groups.slice().sort((a, b) => a.key.localeCompare(b.key));
  const ordered = [remaining.shift()];
  while (remaining.length) {
    const last = ordered[ordered.length - 1];
    let bestIdx = 0, bestScore = -1;
    remaining.forEach((g, idx) => {
      const score = diceCoefficient(last.key, g.key);
      if (score > bestScore) { bestScore = score; bestIdx = idx; }
    });
    ordered.push(remaining.splice(bestIdx, 1)[0]);
  }
  return ordered;
}

function formatNum(n) {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

function uniteLabel(u) {
  const found = UNITES.find(x => x.id === u);
  return found ? found.label : u;
}

function buildCoursesLine(g) {
  const byUnit = new Map(); // unite (ou '__none__') -> [quantités]
  g.entries.forEach(e => {
    const u = e.unite || '__none__';
    if (!byUnit.has(u)) byUnit.set(u, []);
    byUnit.get(u).push(e.quantite);
  });

  const parts = [];
  byUnit.forEach((quantites, unite) => {
    const withValue = quantites.filter(q => q !== null && q !== undefined && !isNaN(q));
    const withoutValue = quantites.length - withValue.length;
    const unitLabel = unite === '__none__' ? '' : ' ' + uniteLabel(unite);
    if (withValue.length === 1) {
      parts.push(`${formatNum(withValue[0])}${unitLabel}`);
    } else if (withValue.length > 1) {
      const allEqual = withValue.every(q => q === withValue[0]);
      if (allEqual) {
        parts.push(`${withValue.length} × ${formatNum(withValue[0])}${unitLabel}`);
      } else {
        const sum = withValue.reduce((a, b) => a + b, 0);
        parts.push(`${formatNum(sum)}${unitLabel} (${withValue.map(v => formatNum(v)).join(' + ')}${unitLabel})`);
      }
    }
    if (withoutValue > 0) {
      parts.push(`×${withoutValue} sans quantité précisée`);
    }
  });

  return {
    nom: g.label,
    detail: parts.join(', '),
    plats: g.entries.map(e => e.plat),
    count: g.entries.length
  };
}

function generateCoursesList() {
  const selected = plats.filter(p => coursesSelection.has(p.id));
  const groups = new Map(); // key normalisée -> { key, label, entries: [{quantite, unite, plat}] }
  selected.forEach(plat => {
    plat.ingredients.filter(i => i.courses).forEach(ing => {
      const key = normalizeName(ing.nom);
      if (!key) return;
      if (!groups.has(key)) groups.set(key, { key, label: ing.nom.trim(), entries: [] });
      groups.get(key).entries.push({ quantite: ing.quantite, unite: ing.unite, plat: plat.nom });
    });
  });

  const ordered = orderBySimilarity(Array.from(groups.values()));
  coursesList = ordered.map(g => buildCoursesLine(g));
  coursesChecked = new Set();
  coursesGenerated = true;
  renderCoursesResult();
}

function renderCoursesResult() {
  document.getElementById('courses-selection').classList.add('hidden');
  document.getElementById('courses-result').classList.remove('hidden');

  const container = document.getElementById('courses-ingredients-list');
  container.innerHTML = '';
  if (!coursesList.length) {
    container.innerHTML = '<p class="empty-inline">Aucun ingrédient coché "courses" dans les plats sélectionnés.</p>';
    return;
  }
  coursesList.forEach((entry, idx) => {
    const row = document.createElement('label');
    row.className = 'courses-row courses-ing-row';
    const checked = coursesChecked.has(idx);
    row.innerHTML = `
      <input type="checkbox" ${checked ? 'checked' : ''}>
      <span class="courses-ing-main">
        <span class="${checked ? 'checked-out' : ''}">${escapeHtml(entry.nom)}</span>
        ${entry.detail ? `<span class="courses-qty">${escapeHtml(entry.detail)}</span>` : ''}
      </span>
      <span class="courses-source">${entry.count > 1 ? `${entry.plats.map(escapeHtml).join(', ')}` : escapeHtml(entry.plats[0])}</span>`;
    row.querySelector('input').onchange = (e) => {
      if (e.target.checked) coursesChecked.add(idx); else coursesChecked.delete(idx);
      renderCoursesResult();
    };
    container.appendChild(row);
  });
}

function restartCourses() {
  coursesGenerated = false;
  coursesSelection = new Set();
  coursesChecked = new Set();
  renderCoursesSelection();
}

// --- Utils ---
function openOverlay(id) { document.getElementById(id).classList.add('show'); }
function closeOverlay(id) { document.getElementById(id).classList.remove('show'); }
function escapeHtml(s) {
  return (s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
