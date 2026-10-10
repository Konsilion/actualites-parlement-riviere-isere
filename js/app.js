/* =========================================================
   Actualités Parlement de la rivière Isère — application
   Lit data/actualites.csv (source de vérité unique), rend une
   grille 3×3 avec carrousel par lots de 9, filtres multi-
   choix Année + Mois (menus déroulants custom) et recherche
   floue insensible casse/accents (calque vitrine Zotero).
   Zéro dépendance, zéro build.
   ========================================================= */
"use strict";

/* ---------- Constantes ---------- */
const CSV_URL = "data/actualites.csv";
const PAGE_SIZE = 9; // 3 lignes × 3 colonnes

const TYPES = {
  evenement_a_venir: { label: "Événement à venir", slug: "evenement-avenir" },
  ressource_publiee: { label: "Ressource publiée", slug: "ressource-publiee" },
  evenement_passe: { label: "Événement passé", slug: "evenement-passe" },
  information_parlement: { label: "Information du parlement", slug: "information-parlement" },
};

const MONTHS_FR = [
  "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
  "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre",
];

/* ---------- État ---------- */
const state = {
  items: [],
  page: 0, // index du lot de 9 (0-based)
  searchText: "",
  selectedYears: new Set(), // années cochées (vide = toutes)
  selectedMonths: new Set(), // numéros de mois "01"-"12" cochés (vide = tous)
};

/* ---------- Références DOM ---------- */
const els = {
  grid: null,
  count: null,
  search: null,
  nav: null,
  yearDropdown: null,
  yearToggle: null,
  yearPill: null,
  yearMenu: null,
  monthDropdown: null,
  monthToggle: null,
  monthPill: null,
  monthMenu: null,
};

function grabEls() {
  els.grid = document.getElementById("grid");
  els.count = document.getElementById("result-count");
  els.search = document.getElementById("search");
  els.nav = document.getElementById("carousel-nav");
  els.yearDropdown = document.getElementById("year-dropdown");
  els.yearToggle = document.getElementById("year-toggle");
  els.yearPill = document.getElementById("year-pill");
  els.yearMenu = document.getElementById("year-menu");
  els.monthDropdown = document.getElementById("month-dropdown");
  els.monthToggle = document.getElementById("month-toggle");
  els.monthPill = document.getElementById("month-pill");
  els.monthMenu = document.getElementById("month-menu");
}

/* ---------- Parseur CSV robuste (RFC 4180 simplifié) ----------
   Gère : virgules dans les champs, guillemets doubles, guillemets
   échappés (""), retours chariot CRLF, UTF-8 (décodage par le
   fetch + TextDecoder). */
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];

    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else if (c === "\r") {
      // ignoré : géré par \n (CRLF)
    } else {
      field += c;
    }
  }
  // dernier champ / dernière ligne
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/* ---------- Conversion lignes → objets ---------- */
function rowsToItems(rows) {
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim());
  const items = [];
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    if (!cells || cells.every((c) => c.trim() === "")) continue; // ligne vide
    const obj = {};
    for (let c = 0; c < header.length; c++) {
      obj[header[c]] = (cells[c] !== undefined ? cells[c] : "").trim();
    }
    items.push(obj);
  }
  return items;
}

/* ---------- Date ISO (AAAA-MM-JJ) → objet Date ---------- */
function parseISO(iso) {
  const parts = (iso || "").trim().split("-");
  if (parts.length !== 3) return null;
  const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  return isNaN(d) ? null : d;
}

/* ---------- Tri : événements à venir d'abord, puis par date ---------- */
function sortItems(items) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const ts = (a) => parseISO(a.date_debut || a.date_ajout || "");

  return items.slice().sort((a, b) => {
    const ta = ts(a) || today;
    const tb = ts(b) || today;
    const aUpcoming = a.type === "evenement_a_venir" && (ta ? ta >= today : false);
    const bUpcoming = b.type === "evenement_a_venir" && (tb ? tb >= today : false);
    // Événements à venir (proches en premier), puis le reste par date desc.
    if (aUpcoming && bUpcoming) return ta - tb;
    if (aUpcoming) return -1;
    if (bUpcoming) return 1;
    return tb - ta;
  });
}

/* ---------- Formatage date FR ---------- */
function formatDate(iso) {
  const parts = (iso || "").split("-");
  if (parts.length !== 3) return iso || "";
  const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  if (isNaN(d)) return iso;
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

function formatDates(item) {
  const de = (item.date_debut || "").trim();
  const fi = (item.date_fin || "").trim();
  if (de && fi && de !== fi) return `Du ${formatDate(de)} au ${formatDate(fi)}`;
  if (de) return `Le ${formatDate(de)}`;
  return "";
}

/* ---------- Recherche : normalisation + fuzzy (calque vitrine) ----------
   Insensible casse/accents + tolérance aux petites fautes. Deux étapes :
     1. sous-chaîne sur le texte NORMALISÉ (casse, accents, œ, ') ;
     2. mode flou par mot : chaque mot significatif (≥ 2 car.) de la
        requête doit se trouver dans la fiche, exact ou à ~1-2 fautes
        près (Damerau-Levenshtein borné).
   Calibrage (vitrine 10/10/26) : 0 faute ≤ 5 car., 1 faute 6-12,
   2 fautes 13-20, floor(n/10) au-delà. */
const FOLD_MAP = { "œ": "oe", "æ": "ae", "Œ": "oe", "Æ": "ae", "’": "'", "‘": "'" };

const searchNormalize = (s) =>
  String(s ?? "")
    .replace(/[œæŒÆ]/g, (m) => FOLD_MAP[m])
    .replace(/[’‘]/g, "'")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

const searchSplitWords = (s) =>
  searchNormalize(s).split(/[^a-z0-9]+/).filter(Boolean);

// Distance de Damerau-Levenshtein restreinte (substitution, insertion,
// suppression, transposition adjacente), bornée par max : renvoie max+1
// dès que la distance excède max (coupe précoce, mots courts).
function boundedEditDistance(a, b, max) {
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > max) return max + 1;
  if (la === 0) return lb > max ? max + 1 : lb;
  let dPrev2 = new Int32Array(lb + 1);
  let dPrev = new Int32Array(lb + 1);
  let dCur = new Int32Array(lb + 1);
  for (let j = 0; j <= lb; j++) dPrev[j] = j;
  for (let i = 1; i <= la; i++) {
    dCur[0] = i;
    let rowMin = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= lb; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      let v = Math.min(dCur[j - 1] + 1, dPrev[j] + 1, dPrev[j - 1] + cost);
      if (
        i > 1 && j > 1 &&
        ca === b.charCodeAt(j - 2) &&
        a.charCodeAt(i - 2) === b.charCodeAt(j - 1)
      ) {
        v = Math.min(v, dPrev2[j - 2] + 1);
      }
      dCur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    const t = dPrev2; dPrev2 = dPrev; dPrev = dCur; dCur = t;
  }
  return dPrev[lb] > max ? max + 1 : dPrev[lb];
}

// Nombre de fautes tolérées pour un mot de la requête.
const typoBudget = (w) =>
  w.length <= 5 ? 0 : w.length <= 12 ? 1 : w.length <= 20 ? 2 : Math.floor(w.length / 10);

// Un mot de requête correspond-il ? Exact d'abord (Set), sinon flou borné
// sur les seuls mots de longueur comparable.
function wordMatches(qWord, index) {
  if (index.set.has(qWord)) return true;
  const budget = typoBudget(qWord);
  if (budget === 0) return false;
  for (const w of index.words) {
    if (w.length < qWord.length - budget || w.length > qWord.length + budget) continue;
    if (boundedEditDistance(qWord, w, budget) <= budget) return true;
  }
  return false;
}

// Index de recherche par actualité, en cache (le CSV ne change pas
// sans recharger la page). Haystack : titre + description + lieu +
// libellé du type (les dates restent dans le filtre mois, pas la
// recherche).
const searchIndexCache = new Map(); // id → { norm, words, set }
function getSearchIndex(item) {
  let index = searchIndexCache.get(item.id);
  if (!index) {
    const norm = searchNormalize(
      [item.titre, item.description, item.lieu, TYPES[item.type]?.label || item.type || ""]
        .join(" ")
    );
    const words = searchSplitWords(norm);
    index = { norm, words, set: new Set(words) };
    searchIndexCache.set(item.id, index);
  }
  return index;
}

function matchesQuery(item, qNorm, qWords) {
  // 1) sous-chaîne normalisée : casse/accents/apostrophes ignorés.
  const index = getSearchIndex(item);
  if (index.norm.includes(qNorm)) return true;
  // 2) mode flou : chaque mot significatif doit matcher indépendamment.
  if (qWords.length === 0) return false;
  return qWords.every((w) => wordMatches(w, index));
}

/* ---------- Échappement HTML ---------- */
function esc(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/* ---------- Rendu d'une carte ---------- */
function renderCard(item) {
  const type = TYPES[item.type] || { label: item.type || "Actualité", slug: "autre" };
  const card = document.createElement("article");
  card.className = "card";

  const badge = document.createElement("span");
  badge.className = `card-type type-${type.slug}`;
  badge.textContent = type.label;
  card.appendChild(badge);

  const title = document.createElement("h2");
  title.className = "card-title";
  title.textContent = item.titre || "(sans titre)";
  card.appendChild(title);

  const desc = document.createElement("p");
  desc.className = "card-description";
  desc.textContent = item.description || "";
  card.appendChild(desc);

  const meta = document.createElement("p");
  meta.className = "card-meta";
  const segs = [];
  const d = formatDates(item);
  if (d) segs.push(d);
  if (item.lieu) segs.push(item.lieu);
  meta.textContent = segs.join(" · ");
  if (segs.length) card.appendChild(meta);

  if (item.lien && /^https?:\/\//i.test(item.lien)) {
    const linkWrap = document.createElement("p");
    linkWrap.className = "card-link";
    const a = document.createElement("a");
    a.href = item.lien;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = "En savoir plus";
    linkWrap.appendChild(a);
    card.appendChild(linkWrap);
  }

  return card;
}

/* ---------- Mois / années couverts par une actualité ----------
   Une actualité appartient à tous les mois couverts par sa
   période (date_debut → date_fin, ou date_debut/date_ajout
   seul si pas de fin) : une exposition de juillet à novembre
   apparaît dans chacun de ces mois. */
function itemMonths(item) {
  const de = parseISO(item.date_debut || item.date_ajout || "");
  const fi = parseISO(item.date_fin || item.date_debut || item.date_ajout || "");
  const months = [];
  if (!de || !fi) return months;
  let cur = new Date(de.getFullYear(), de.getMonth(), 1);
  const end = new Date(fi.getFullYear(), fi.getMonth(), 1);
  // Garde-fou : 24 mois max par item (données corrompues → pas de boucle folle)
  while (cur <= end && months.length < 24) {
    months.push(`${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}`);
    cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
  }
  return months;
}

function itemYears(item) {
  const years = new Set();
  for (const m of itemMonths(item)) years.add(m.slice(0, 4));
  return years;
}

/* ---------- Filtrage combiné (recherche ∧ année ∧ mois) ---------- */
function getFilteredItems() {
  const qNorm = searchNormalize(state.searchText.trim());
  const qWords = qNorm ? qNorm.split(/[^a-z0-9]+/).filter((w) => w.length >= 2) : [];

  return state.items.filter((it) => {
    if (qNorm && !matchesQuery(it, qNorm, qWords)) return false;
    if (state.selectedYears.size > 0 && !hasIntersection(itemYears(it), state.selectedYears)) {
      return false;
    }
    if (state.selectedMonths.size > 0) {
      // Mois génériques "01"-"12" : l'année est portée par le filtre Année.
      const months = new Set(itemMonths(it).map((k) => k.slice(5)));
      if (!hasIntersection(months, state.selectedMonths)) return false;
    }
    return true;
  });
}

function hasIntersection(a, b) {
  for (const v of a) if (b.has(v)) return true;
  return false;
}

/* ---------- Menus déroulants multi-choix (Année, Mois) ----------
   Le <select> natif ne permet PAS le multi-choix : dropdown custom
   (calque vitrine) — bouton pill + menu checkboxes, clic-dehors et
   Échap ferment, l'option « Tous… » décoche tout d'un clic. */

function buildFilterOption(cfg) {
  // cfg : { value, label, checked, isAll, onChange }
  const row = document.createElement("label");
  row.className = "f-option" + (cfg.isAll ? " f-all" : "");
  row.dataset.value = cfg.value;
  row.setAttribute("role", "option");

  const box = document.createElement("input");
  box.type = "checkbox";
  box.checked = cfg.checked;
  box.addEventListener("change", () => cfg.onChange(box.checked));

  const name = document.createElement("span");
  name.className = "f-option-name";
  name.textContent = cfg.label;

  row.append(box, name);
  return row;
}

function monthLabel(num) {
  // Numéro "01"-"12" → nom du mois seul (l'année vit dans le filtre Année).
  return MONTHS_FR[Number(num) - 1];
}

// Fabrique un dropdown multi-choix générique (utilisé pour Année et Mois).
function makeDropdown({ dropdown, toggle, pill, menu, set, allLabel, unitWord, labelOf }) {
  const isOpen = () => menu.classList.contains("open");
  const setOpen = (open) => {
    dropdown.classList.toggle("open", open);
    menu.classList.toggle("open", open);
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
  };

  function pillLabel() {
    const n = set.size;
    if (n === 0) return allLabel;
    if (n === 1) return labelOf([...set][0]);
    return `${n} ${unitWord}`;
  }

  function syncUI() {
    menu.querySelectorAll(".f-option").forEach((row) => {
      const value = row.dataset.value;
      const checked = value === "" ? set.size === 0 : set.has(value);
      row.querySelector("input").checked = checked;
      row.classList.toggle("active", checked);
      row.setAttribute("aria-selected", checked ? "true" : "false");
    });
    pill.textContent = pillLabel();
    toggle.classList.toggle("active", set.size > 0);
  }

  toggle.addEventListener("click", () => setOpen(!isOpen()));
  document.addEventListener("click", (e) => {
    if (isOpen() && !dropdown.contains(e.target)) setOpen(false);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isOpen()) {
      setOpen(false);
      toggle.focus();
    }
  });

  return { setOpen, syncUI };
}

/* ---------- Remplissage des menus ---------- */
function fillMenu(menu, allLabel, entries, set, syncFn) {
  // entries : [{ value, label }]
  menu.innerHTML = "";
  menu.appendChild(
    buildFilterOption({
      value: "",
      label: allLabel,
      checked: set.size === 0,
      isAll: true,
      onChange: () => {
        set.clear();
        state.page = 0;
        syncFn();
        renderGrid();
      },
    })
  );
  for (const en of entries) {
    menu.appendChild(
      buildFilterOption({
        value: en.value,
        label: en.label,
        checked: set.has(en.value),
        isAll: false,
        onChange: (checked) => {
          if (checked) set.add(en.value);
          else set.delete(en.value);
          state.page = 0;
          syncFn();
          renderGrid();
        },
      })
    );
  }
}

function buildFilterMenus() {
  // Années distinctes couvertes, triées desc.
  const years = new Set();
  for (const it of state.items) for (const y of itemYears(it)) years.add(y);
  fillMenu(
    els.yearMenu,
    "Toutes les années",
    [...years].sort((a, b) => b.localeCompare(a)).map((y) => ({ value: y, label: y })),
    state.selectedYears,
    () => yearDD.syncUI()
  );

  // Mois distincts couverts (numéro générique "01"-"12", sans année),
  // dans l'ordre chronologique du calendrier — pas par récence.
  const keys = new Set();
  for (const it of state.items) for (const m of itemMonths(it)) keys.add(m.slice(5));
  fillMenu(
    els.monthMenu,
    "Tous les mois",
    [...keys].sort((a, b) => a.localeCompare(b)).map((k) => ({ value: k, label: monthLabel(k) })),
    state.selectedMonths,
    () => monthDD.syncUI()
  );

  yearDD.syncUI();
  monthDD.syncUI();
}

/* ---------- Carrousel : rendu du lot courant ---------- */
function renderGrid() {
  if (!els.grid) return;
  els.grid.innerHTML = "";

  const items = getFilteredItems();
  if (!items.length) {
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent =
      state.searchText.trim() || state.selectedYears.size || state.selectedMonths.size
        ? "Aucune actualité ne correspond à ces filtres."
        : "Aucune actualité pour le moment.";
    els.grid.appendChild(p);
    updateCount(0);
    renderNav();
    return;
  }

  const start = state.page * PAGE_SIZE;
  const slice = items.slice(start, start + PAGE_SIZE);
  for (const item of slice) {
    els.grid.appendChild(renderCard(item));
  }
  updateCount(items.length);
  renderNav();
}

function updateCount(n) {
  if (!els.count) return;
  els.count.textContent = n === 0 ? "aucune actualité" : `${n} actualité${n > 1 ? "s" : ""}`;
}

/* ---------- Navigation du carrousel ---------- */
function pageCount() {
  return Math.max(1, Math.ceil(getFilteredItems().length / PAGE_SIZE));
}

function renderNav() {
  if (!els.nav) return;
  els.nav.innerHTML = "";

  if (getFilteredItems().length <= PAGE_SIZE) return; // une seule page : pas de nav

  const prev = document.createElement("button");
  prev.type = "button";
  prev.className = "carousel-btn";
  prev.textContent = "‹ Précédent";
  prev.disabled = state.page === 0;
  prev.addEventListener("click", () => {
    if (state.page > 0) {
      state.page--;
      renderGrid();
      scrollToTop();
    }
  });
  els.nav.appendChild(prev);

  const pos = document.createElement("span");
  pos.className = "carousel-position";
  pos.textContent = `Page ${state.page + 1} / ${pageCount()}`;
  els.nav.appendChild(pos);

  const next = document.createElement("button");
  next.type = "button";
  next.className = "carousel-btn";
  next.textContent = "Suivant ›";
  next.disabled = state.page >= pageCount() - 1;
  next.addEventListener("click", () => {
    if (state.page < pageCount() - 1) {
      state.page++;
      renderGrid();
      scrollToTop();
    }
  });
  els.nav.appendChild(next);
}

function scrollToTop() {
  window.scrollTo({ top: 0, behavior: "smooth" });
}

/* ---------- Chargement initial ---------- */
async function load() {
  try {
    const resp = await fetch(CSV_URL, { cache: "no-cache" });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const text = await resp.text();
    const items = rowsToItems(parseCSV(text));
    state.items = sortItems(items);
  } catch (err) {
    console.error("Erreur de chargement des actualités :", err);
    if (els.grid) {
      els.grid.innerHTML = "";
      const p = document.createElement("p");
      p.className = "empty";
      p.textContent = "Impossible de charger les actualités.";
      els.grid.appendChild(p);
    }
    return;
  }
  state.page = 0;
  buildFilterMenus();
  renderGrid();
}

/* ---------- Écouteurs ---------- */
function attachListeners() {
  let searchTimer = null;
  els.search.addEventListener("input", (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.searchText = e.target.value;
      state.page = 0; // tout filtre ramène au premier lot
      renderGrid();
    }, 150);
  });
}

/* ---------- Boot ---------- */
grabEls();
const yearDD = makeDropdown({
  dropdown: els.yearDropdown,
  toggle: els.yearToggle,
  pill: els.yearPill,
  menu: els.yearMenu,
  set: state.selectedYears,
  allLabel: "Toutes les années",
  unitWord: "années",
  labelOf: (v) => v,
});
const monthDD = makeDropdown({
  dropdown: els.monthDropdown,
  toggle: els.monthToggle,
  pill: els.monthPill,
  menu: els.monthMenu,
  set: state.selectedMonths,
  allLabel: "Tous les mois",
  unitWord: "mois",
  labelOf: monthLabel,
});
attachListeners();
document.addEventListener("DOMContentLoaded", load);
