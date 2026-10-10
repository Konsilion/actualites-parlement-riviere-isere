/* =========================================================
   Actualités Parlement de la rivière Isère — application
   Lit data/actualites.csv (source de vérité unique), rend une
   grille 3×3 avec carrousel par lots de 9.
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

/* ---------- État ---------- */
const state = {
  items: [],
  page: 0, // index du lot de 9 (0-based)
};

/* ---------- Parseur CSV robuste (RFC 4180 simplifié) ----------
   Gère : virgules dans les champs, guillemets doubles, guillemets
   échappés ("") , retours chariot CRLF, UTF-8 (décodage par le
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

/* ---------- Tri : événements à venir d'abord, puis par date ---------- */
function sortItems(items) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const ts = (a) => {
    const d = (a.date_debut || a.date_ajout || "").trim();
    const parts = d.split("-");
    if (parts.length === 3) {
      const dt = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
      if (!isNaN(dt)) return dt;
    }
    return null;
  };

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

  if (item.lien) {
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

/* ---------- Carrousel : rendu du lot courant ---------- */
function renderGrid() {
  const grid = document.getElementById("grid");
  if (!grid) return;
  grid.innerHTML = "";

  if (!state.items.length) {
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = "Aucune actualité pour le moment.";
    grid.appendChild(p);
    updateCount(0);
    renderNav();
    return;
  }

  const start = state.page * PAGE_SIZE;
  const slice = state.items.slice(start, start + PAGE_SIZE);
  for (const item of slice) {
    grid.appendChild(renderCard(item));
  }
  updateCount(state.items.length);
  renderNav();
}

function updateCount(n) {
  const el = document.getElementById("result-count");
  if (!el) return;
  el.textContent = n === 0 ? "aucune actualité" : `${n} actualité${n > 1 ? "s" : ""}`;
}

/* ---------- Navigation du carrousel ---------- */
function pageCount() {
  return Math.max(1, Math.ceil(state.items.length / PAGE_SIZE));
}

function renderNav() {
  const nav = document.getElementById("carousel-nav");
  if (!nav) return;
  nav.innerHTML = "";

  if (state.items.length <= PAGE_SIZE) return; // une seule page : pas de nav

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
  nav.appendChild(prev);

  const pos = document.createElement("span");
  pos.className = "carousel-position";
  pos.textContent = `Page ${state.page + 1} / ${pageCount()}`;
  nav.appendChild(pos);

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
  nav.appendChild(next);
}

function scrollToTop() {
  window.scrollTo({ top: 0, behavior: "smooth" });
}

/* ---------- Chargement initial ---------- */
async function load() {
  const grid = document.getElementById("grid");
  try {
    const resp = await fetch(CSV_URL, { cache: "no-cache" });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const text = await resp.text();
    const items = rowsToItems(parseCSV(text));
    state.items = sortItems(items);
  } catch (err) {
    console.error("Erreur de chargement des actualités :", err);
    if (grid) {
      grid.innerHTML = "";
      const p = document.createElement("p");
      p.className = "empty";
      p.textContent = "Impossible de charger les actualités.";
      grid.appendChild(p);
    }
    return;
  }
  state.page = 0;
  renderGrid();
}

document.addEventListener("DOMContentLoaded", load);
