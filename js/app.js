/* =========================================================
   Actualités Parlement de la rivière Isère — application
   Lit data/actualites.csv (source de vérité unique), rend une
   grille de cartes avec pagination calque strict de la vitrine
   Zotero (‹ numéros › sélectionnables, barres haut + bas
   synchronisées, taille de page 9/18/36/Tout), filtres multi-
   choix Année + Mois (menus déroulants custom) et recherche
   floue insensible casse/accents (calque vitrine Zotero).
   Zéro dépendance, zéro build.
   ========================================================= */
"use strict";

/* ---------- Constantes ---------- */
const CSV_URL = "data/actualites.csv";

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
  searchText: "",
  selectedYears: new Set(), // années cochées (vide = toutes)
  selectedMonths: new Set(), // numéros de mois "01"-"12" cochés (vide = tous)
  pageSize: "9", // "9" | "18" | "36" | "all" (calque vitrine Zotero)
  currentPage: 0, // index 0-based
};

/* ---------- Références DOM ---------- */
const els = {
  grid: null,
  count: null,
  search: null,
  pagination: null,
  paginationTop: null,
  pageSizeSelect: null,
  yearDropdown: null,
  yearToggle: null,
  yearPill: null,
  yearMenu: null,
  monthDropdown: null,
  monthToggle: null,
  monthPill: null,
  monthMenu: null,
  monthPills: null,
};

function grabEls() {
  els.grid = document.getElementById("grid");
  els.count = document.getElementById("result-count");
  els.search = document.getElementById("search");
  els.pagination = document.getElementById("pagination");
  els.paginationTop = document.getElementById("pagination-top");
  els.pageSizeSelect = document.getElementById("page-size-select");
  els.yearDropdown = document.getElementById("year-dropdown");
  els.yearToggle = document.getElementById("year-toggle");
  els.yearPill = document.getElementById("year-pill");
  els.yearMenu = document.getElementById("year-menu");
  els.monthDropdown = document.getElementById("month-dropdown");
  els.monthToggle = document.getElementById("month-toggle");
  els.monthPill = document.getElementById("month-pill");
  els.monthMenu = document.getElementById("month-menu");
  els.monthPills = document.getElementById("month-pills");
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
        state.currentPage = 0; // tout filtre ramène à la page 1 (calque vitrine)
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
          state.currentPage = 0; // tout filtre ramène à la page 1 (calque vitrine)
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

/* ---------- Filtres cochés par défaut (CEO 11/10/26) ----------
   À l'ouverture : année en cours + mois en cours et mois à venir
   cochés — la page démarre sur l'actualité du moment, l'archive
   reste accessible en décochant. En décembre, le mois à venir
   est janvier de l'année suivante : on coche aussi l'année
   suivante, sinon les items du mois à venir seraient filtrés.
   `now` est paramétrable pour tester le passage d'année. */
function applyDefaultFilters(now = new Date()) {
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const nextMonth = now.getMonth() === 11 ? "01" : String(now.getMonth() + 2).padStart(2, "0");
  state.selectedYears.add(year);
  state.selectedMonths.add(month);
  state.selectedMonths.add(nextMonth);
  if (nextMonth === "01") state.selectedYears.add(String(now.getFullYear() + 1));
}

/* ---------- Pastilles des mois sélectionnés (CEO 11/10/26) ----------
   Une pastille par mois coché, à droite du filtre Mois ; la croix
   retire le mois (menu, pill du filtre et grille resynchronisés).
   Appelée à chaque renderGrid : aucun chemin de changement ne peut
   désynchroniser les pastilles du menu. */
function renderMonthPills() {
  if (!els.monthPills) return;
  els.monthPills.innerHTML = "";

  const months = [...state.selectedMonths].sort((a, b) => a.localeCompare(b));
  for (const m of months) {
    const pill = document.createElement("span");
    pill.className = "month-pill";

    const label = document.createElement("span");
    label.className = "month-pill-name";
    label.textContent = monthLabel(m);
    pill.appendChild(label);

    const x = document.createElement("button");
    x.type = "button";
    x.className = "month-pill-x";
    x.setAttribute("aria-label", "Retirer le filtre " + monthLabel(m));
    x.textContent = "×";
    x.addEventListener("click", () => {
      state.selectedMonths.delete(m);
      state.currentPage = 0; // tout changement de filtre ramène à la page 1
      monthDD.syncUI();
      renderGrid();
    });
    pill.appendChild(x);

    els.monthPills.appendChild(pill);
  }
}

/* ---------- Pagination (calque strict de la vitrine Zotero) ---------- */
// Calcule la tranche courante + borne currentPage.
function paginate(filtered) {
  const pageSizeNum = (state.pageSize === "all") ? filtered.length : parseInt(state.pageSize, 10);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSizeNum));
  if (state.currentPage >= totalPages) state.currentPage = totalPages - 1;
  if (state.currentPage < 0) state.currentPage = 0;
  const startIdx = state.currentPage * pageSizeNum;
  return {
    totalPages,
    pageRows: filtered.slice(startIdx, startIdx + pageSizeNum),
  };
}

/* ---------- Rendu de la page courante ---------- */
function renderGrid() {
  if (!els.grid) return;
  els.grid.innerHTML = "";
  renderMonthPills();

  const items = getFilteredItems();
  const { totalPages, pageRows } = paginate(items);
  renderPagination(totalPages);

  if (!items.length) {
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent =
      state.searchText.trim() || state.selectedYears.size || state.selectedMonths.size
        ? "Aucune actualité ne correspond à ces filtres."
        : "Aucune actualité pour le moment.";
    els.grid.appendChild(p);
    updateCount(0);
    return;
  }

  for (const item of pageRows) {
    els.grid.appendChild(renderCard(item));
  }
  updateCount(items.length);
}

function updateCount(n) {
  if (!els.count) return;
  els.count.textContent = n === 0 ? "aucune actualité" : `${n} actualité${n > 1 ? "s" : ""}`;
}

/* ---------- Barres de pagination (haut + bas, synchronisées) ----------
   ‹ / numéros / › : tous les numéros si ≤ 6 pages, sinon fenêtre
   [première, dernière, courant±1] avec « … ». Chaque changement de
   filtre ramène à la page 1 (calque vitrine Zotero). */
function renderPagination(totalPages) {
  const navs = [els.pagination, els.paginationTop].filter(Boolean);

  if (state.pageSize === "all" || totalPages <= 1) {
    navs.forEach((nav) => (nav.innerHTML = ""));
    return;
  }

  let html = `<button type="button" class="page-btn" data-page="prev" ${state.currentPage === 0 ? "disabled" : ""} aria-label="Page précédente">‹</button>`;

  if (totalPages <= 6) {
    for (let i = 0; i < totalPages; i++) {
      html += `<button type="button" class="page-num${i === state.currentPage ? " active" : ""}" data-page="${i}">${i + 1}</button>`;
    }
  } else {
    const pages = new Set([0, totalPages - 1, state.currentPage, state.currentPage - 1, state.currentPage + 1]);
    let prevShown = -1;
    for (let i = 0; i < totalPages; i++) {
      if (pages.has(i)) {
        html += `<button type="button" class="page-num${i === state.currentPage ? " active" : ""}" data-page="${i}">${i + 1}</button>`;
        prevShown = i;
      } else if (prevShown !== -2) {
        html += `<span class="page-ellipsis">…</span>`;
        prevShown = -2;
      }
    }
  }

  html += `<button type="button" class="page-btn" data-page="next" ${state.currentPage >= totalPages - 1 ? "disabled" : ""} aria-label="Page suivante">›</button>`;

  navs.forEach((nav) => {
    nav.innerHTML = html;
    nav.querySelectorAll("button[data-page]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const p = btn.dataset.page;
        const prev = state.currentPage;
        if (p === "prev") state.currentPage = Math.max(0, state.currentPage - 1);
        else if (p === "next") state.currentPage = state.currentPage + 1;
        else state.currentPage = parseInt(p, 10);
        if (state.currentPage !== prev) {
          renderGrid();
          scrollToTop();
        }
      });
    });
  });
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
  state.currentPage = 0;
  applyDefaultFilters(); // année en cours + mois en cours/à venir cochés (CEO 11/10/26)
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
      state.currentPage = 0; // tout filtre ramène à la page 1 (calque vitrine)
      renderGrid();
    }, 150);
  });

  if (els.pageSizeSelect) {
    els.pageSizeSelect.addEventListener("change", (e) => {
      state.pageSize = e.target.value;
      state.currentPage = 0; // changement de taille de page → retour page 1
      renderGrid();
    });
  }
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
