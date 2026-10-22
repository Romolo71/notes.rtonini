/* =====================================================================
   Backend Node.js per "Appunti Universitari"  ->  Notion API
   Nessuna dipendenza: serve Node 18+ (fetch e http sono già inclusi).

   AVVIO
     NOTION_TOKEN=secret_xxx NOTION_DATABASE_ID=xxxxxxxx node server.js

   VARIABILI D'AMBIENTE
     NOTION_TOKEN          (obbligatoria) token della tua integrazione Notion
     NOTION_DATABASE_ID    (obbligatoria) ID del database degli appunti
     NOTION_DATA_SOURCE_ID (opzionale) fonte dati degli appunti; se manca si usa la prima che non si chiama "voti"
     NOTION_VOTI_DATA_SOURCE_ID (opzionale) fonte dati delle correzioni ("voti")
     NOTION_VOTI_DATABASE_ID    (opzionale) se le correzioni sono in un database separato
                                (se nessuna delle due è impostata, cerca nel database una fonte che
                                 contiene "voti" o "correzion" nel nome)
     PORT                  (default 3000)
     ALLOWED_ORIGIN        (default *) dominio del sito che chiama l'API
     CACHE_SECONDS         (default 60)

   ENDPOINT
     GET /api/notes                      lista appunti con Pubblica = true
     GET /api/notes/:id/blocks           contenuto di un appunto (solo se pubblico)
     GET /api/notes/:id/img/:blockId     immagine di un appunto (solo se pubblico)
     GET /api/notes/:id/icon             icona della pagina caricata su Notion (solo se pubblica)
     GET /api/corrections                lista correzioni (fonte "voti") con Pubblica = true
     GET /                               serve appunti.html (comodo in locale)
   ===================================================================== */
const http = require("http");
const fs = require("fs");
const path = require("path");
const { Readable } = require("stream");

const {
  NOTION_TOKEN,
  NOTION_DATABASE_ID,
  NOTION_DATA_SOURCE_ID,
  NOTION_VOTI_DATA_SOURCE_ID,
  NOTION_VOTI_DATABASE_ID,
  PORT = 3000,
  ALLOWED_ORIGIN = "*",
  CACHE_SECONDS = 60,
} = process.env;

if (!NOTION_TOKEN || !NOTION_DATABASE_ID) {
  console.error("Mancano NOTION_TOKEN e/o NOTION_DATABASE_ID.");
  process.exit(1);
}

const NOTION_VERSION = "2026-03-11";
const NOTION_URL = "https://api.notion.com/v1";

/* Nomi esatti delle proprietà nel tuo database Notion */
/* (Il titolo non serve qui: viene riconosciuto automaticamente dal tipo di colonna.) */
const PROP = {
  pubblica: "Pubblica",
  corso: "class",
  autore: "Autore",
  data: "Data creazione",
};

const clean = (id) =>
  String(id || "")
    .replace(/-/g, "")
    .toLowerCase();

/* ---------- Chiamata a Notion (con retry se rate-limited) ---------- */
async function notion(endpoint, { method = "GET", body } = {}, attempt = 0) {
  const res = await fetch(NOTION_URL + endpoint, {
    method,
    headers: {
      Authorization: `Bearer ${NOTION_TOKEN}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 429 && attempt < 3) {
    const wait = Number(res.headers.get("retry-after") || 1) * 1000;
    await new Promise((r) => setTimeout(r, wait));
    return notion(endpoint, { method, body }, attempt + 1);
  }
  if (!res.ok) {
    const err = new Error(
      `Notion ${res.status}: ${(await res.text()).slice(0, 300)}`,
    );
    err.status = res.status;
    throw err;
  }
  return res.json();
}

/* ---------- Fonti dati: "appunti" e "voti" ----------
   Dal 2025 un database Notion può avere più "fonti dati" (data source). Le riconosciamo così:
   - appunti: NOTION_DATA_SOURCE_ID se impostata, altrimenti la prima fonte che NON si chiama "voti"/"correzioni"
   - voti:    NOTION_VOTI_DATA_SOURCE_ID se impostata; oppure la prima fonte del database NOTION_VOTI_DATABASE_ID;
              oppure, nello stesso database, la fonte il cui nome contiene "voti" o "correzion" */
let sourcesPromise = null;
function getSources() {
  if (!sourcesPromise)
    sourcesPromise = resolveSources().catch((e) => {
      sourcesPromise = null; // riprova alla prossima richiesta
      throw e;
    });
  return sourcesPromise;
}
async function resolveSources() {
  const db = await notion(`/databases/${NOTION_DATABASE_ID}`);
  const list = db.data_sources || []; // [{ id, name }]
  console.log(
    "Fonti dati del database:",
    list.map((s) => `"${s.name}" (${s.id})`).join(", ") || "nessuna",
  );
  const isVoti = (s) => /voti|correzion/i.test(s.name || "");
  const notes =
    NOTION_DATA_SOURCE_ID || (list.find((s) => !isVoti(s)) || list[0])?.id;
  if (!notes)
    throw new Error(
      "Nessun data source trovato: imposta NOTION_DATA_SOURCE_ID.",
    );
  const dbs = new Set([clean(NOTION_DATABASE_ID)]);
  let voti = NOTION_VOTI_DATA_SOURCE_ID || null;
  if (!voti && NOTION_VOTI_DATABASE_ID) {
    try {
      const vdb = await notion(`/databases/${NOTION_VOTI_DATABASE_ID}`);
      voti = vdb.data_sources?.[0]?.id || null;
      dbs.add(clean(NOTION_VOTI_DATABASE_ID));
    } catch (e) {
      console.error("Database dei voti non raggiungibile:", e.message);
    }
  }
  if (!voti)
    voti =
      list.find((s) => clean(s.id) !== clean(notes) && isVoti(s))?.id || null;
  if (voti && clean(voti) === clean(notes)) voti = null;
  console.log("Fonte appunti:", notes, "| fonte voti:", voti || "non trovata");
  // Le uniche fonti da cui si può leggere: tutto il resto del database resta privato
  const sources = new Set([notes, voti].filter(Boolean).map(clean));
  return { notes, voti, sources, dbs };
}

/* ---------- Conversione proprietà Notion -> formato del frontend ---------- */
const plain = (rt = []) => rt.map((t) => t.plain_text).join("");
// Trova una colonna per nome ignorando maiuscole/minuscole e spazi ("class" = "Class" = " class ")
const prop = (p, name) =>
  p[name] ??
  p[Object.keys(p).find((k) => k.trim().toLowerCase() === name.toLowerCase())];

function mapPage(page) {
  const p = page.properties;
  // Se la colonna del corso ha un altro nome (succede nella fonte "voti"), si usa la prima colonna Select/Multi-select/Status
  const corsoProp =
    prop(p, PROP.corso) ||
    Object.values(p).find((v) =>
      ["select", "multi_select", "status"].includes(v.type),
    );
  const corso = corsoProp?.select
    ? corsoProp.select // { name, color }
    : corsoProp?.multi_select
      ? corsoProp.multi_select // [{ name, color }]
      : corsoProp?.status
        ? corsoProp.status // { name, color }
        : corsoProp?.rich_text
          ? plain(corsoProp.rich_text) // testo semplice (senza colore)
          : [];
  // Il titolo si trova per TIPO, non per nome: in Notion la colonna titolo può chiamarsi "Nome", "Name", "Titolo"…
  const titleKey = Object.keys(p).find((k) => p[k].type === "title");
  const a = prop(p, PROP.autore);
  const autore = a?.people
    ? a.people.map((u) => u.name).filter(Boolean)
    : a?.rich_text
      ? plain(a.rich_text)
      : a?.created_by
        ? [a.created_by.name].filter(Boolean)
        : [];
  const d = prop(p, PROP.data);
  const data = d?.created_time || d?.date?.start || page.created_time;
  return {
    id: page.id,
    titolo: plain(p[titleKey]?.title) || "Senza titolo",
    pubblica: p[PROP.pubblica]?.checkbox === true,
    corso,
    autore,
    dataCreazione: data,
    url: page.url,
    icon: mapIcon(page),
  };
}

/* Icona della pagina, come la mostra Notion: emoji, immagine caricata, link esterno o icona nativa */
function mapIcon(page, route = "/api/notes/") {
  const ic = page.icon;
  if (!ic) return null;
  if (ic.type === "emoji") return { type: "emoji", emoji: ic.emoji };
  if (ic.type === "external" && ic.external?.url)
    return { type: "url", url: ic.external.url };
  if (ic.type === "custom_emoji" && ic.custom_emoji?.url)
    return { type: "url", url: ic.custom_emoji.url };
  // Le immagini caricate su Notion hanno un link che scade dopo ~1 ora: le serviamo noi da /api/notes/:id/icon
  if (ic.type === "file")
    return { type: "url", url: `${route}${page.id}/icon` };
  // Icone native di Notion (nome + colore): indirizzo pubblico di Notion, il sito ripiega sulla favicon della home se non si carica
  if (ic.type === "icon" && ic.icon?.name)
    return {
      type: "url",
      url: `https://www.notion.so/icons/${ic.icon.name}_${ic.icon.color || "gray"}.svg`,
    };
  return null;
}

/* ---------- Blocchi Notion -> formato del frontend ---------- */
const SUPPORTED = new Set([
  "paragraph",
  "heading_1",
  "heading_2",
  "heading_3",
  "bulleted_list_item",
  "numbered_list_item",
  "quote",
  "to_do",
  "callout",
  "code",
  "toggle",
]);

// Per ogni pagina, gli ID delle immagini caricate su Notion
// (serve a impedire di scaricare, tramite questa pagina, immagini di altre pagine)
const imageIndex = new Map();

// Nome "pulito" per l'immagine: prima la didascalia scritta in Notion, altrimenti il nome originale del file.
// È ciò che si vede nella scheda del browser e quando si salva l'immagine.
function imageName(b) {
  const slug = (s) =>
    s
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60);
  let orig = "";
  try {
    const u = new URL(b.image.file?.url || b.image.external?.url);
    orig = decodeURIComponent(u.pathname.split("/").pop());
  } catch {}
  const ext = (orig.match(/\.(png|jpe?g|gif|webp|svg|avif)$/i) || [
    ".png",
  ])[0].toLowerCase();
  const base =
    slug(plain(b.image.caption || [])) ||
    slug(orig.replace(/\.[^.]+$/, "")) ||
    "immagine";
  return base + ext;
}

function mapBlock(b, root) {
  if (b.type === "divider") return { type: "divider" };
  if (b.type === "heading_4")
    return { type: "heading_3", rich_text: b.heading_4.rich_text };
  // Formula a blocco: Notion la salva come stringa KaTeX (LaTeX) in equation.expression.
  // Le formule dentro al testo (inline) restano nei rich_text con type "equation": le gestisce il frontend.
  if (b.type === "equation")
    return { type: "equation", expression: b.equation?.expression || "" };
  if (b.type === "image") {
    const img = b.image;
    const isFile = img.type === "file";
    if (isFile) {
      // Le immagini caricate su Notion hanno un link che scade dopo ~1 ora:
      // le serviamo noi, tramite /api/notes/:id/img/:blockId
      if (!imageIndex.has(clean(root))) imageIndex.set(clean(root), new Set());
      imageIndex.get(clean(root)).add(clean(b.id));
    }
    return {
      type: "image",
      url: isFile
        ? `/api/notes/${root}/img/${b.id}/${imageName(b)}`
        : img.external?.url,
      caption: img.caption || [],
    };
  }
  if (!SUPPORTED.has(b.type)) return null; // embed, video, file… non ancora gestiti
  const c = b[b.type];
  const out = {
    type: b.type === "toggle" ? "paragraph" : b.type,
    rich_text: c.rich_text,
  };
  if (b.type === "to_do") out.checked = c.checked;
  if (b.type === "callout") out.icon = c.icon?.emoji || "💡";
  if (b.type === "code") out.language = c.language;
  return out;
}

// Elenca TUTTI i figli di un blocco (Notion li restituisce a pagine da 100)
async function listChildren(blockId) {
  const all = [];
  let cursor;
  do {
    const q = `?page_size=100${cursor ? `&start_cursor=${cursor}` : ""}`;
    const r = await notion(`/blocks/${blockId}/children${q}`);
    all.push(...r.results);
    cursor = r.has_more ? r.next_cursor : null;
  } while (cursor);
  return all;
}

async function fetchBlocks(blockId, depth = 0, root = blockId) {
  if (depth === 0) imageIndex.delete(clean(blockId));
  const out = [];
  for (const b of await listChildren(blockId)) {
    // Una tabella è un blocco "table" le cui RIGHE sono blocchi figli ("table_row"):
    // le leggiamo qui e le consegniamo al frontend come un unico blocco con tutte le celle.
    if (b.type === "table") {
      const rows = (await listChildren(b.id))
        .filter((r) => r.type === "table_row")
        .map((r) => r.table_row.cells); // ogni cella è una lista di rich_text
      out.push({
        type: "table",
        header_row: b.table?.has_column_header === true,
        header_col: b.table?.has_row_header === true,
        rows,
      });
      continue;
    }
    const m = mapBlock(b, root);
    if (m) out.push(m);
    // I blocchi annidati (toggle, sotto-elenchi, colonne) richiedono una chiamata a parte
    if (
      b.has_children &&
      depth < 3 &&
      !["child_page", "child_database"].includes(b.type)
    ) {
      out.push(...(await fetchBlocks(b.id, depth + 1, root)));
    }
  }
  return out;
}

/* ---------- Cache semplice in memoria ---------- */
const cache = new Map();
async function cached(key, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < CACHE_SECONDS * 1000) return hit.v;
  const v = await fn();
  cache.set(key, { t: Date.now(), v });
  return v;
}

/* ---------- Logica API ---------- */
async function listSource(ds, label, enrich) {
  const results = [];
  let cursor;
  do {
    const r = await notion(`/data_sources/${ds}/query`, {
      method: "POST",
      body: {
        // Il filtro sta QUI, lato server: le pagine non pubbliche non lasciano mai Notion
        filter: { property: PROP.pubblica, checkbox: { equals: true } },
        sorts: [{ timestamp: "created_time", direction: "descending" }],
        page_size: 100,
        ...(cursor && { start_cursor: cursor }),
      },
    });
    results.push(...r.results);
    cursor = r.has_more ? r.next_cursor : null;
  } while (cursor);
  // Diagnostica: scrive nel log i nomi e i tipi delle colonne trovate (utile se qualcosa risulta vuoto)
  if (results[0])
    console.log(
      `Colonne trovate (${label}):`,
      Object.entries(results[0].properties)
        .map(([k, v]) => `"${k}" (${v.type})`)
        .join(", "),
    );
  const pages = results.filter((p) => p.object === "page" && !p.in_trash);
  const mapped = await Promise.all(
    pages.map(async (p) => (enrich ? enrich(p, mapPage(p)) : mapPage(p))),
  );
  return mapped.filter((n) => n.pubblica);
}

/* Nella fonte "voti" la materia è una RELAZIONE verso la pagina del corso: si legge il titolo della pagina collegata
   e si prende il colore dal corso omonimo degli appunti (così le correzioni hanno lo stesso colore della materia). */
const relTitle = async (id) => {
  try {
    const pg = await cached(`rel:${id}`, () => notion(`/pages/${id}`));
    const k = Object.keys(pg.properties || {}).find(
      (x) => pg.properties[x].type === "title",
    );
    return plain(pg.properties[k]?.title) || "";
  } catch {
    return "";
  }
};
async function enrichVoti(page, n, colors) {
  const props = page.properties;
  const rel =
    prop(props, "Materia") ||
    Object.values(props).find((v) => v.type === "relation");
  let name = "";
  if (rel?.relation?.[0]?.id) name = await relTitle(rel.relation[0].id);
  else if (rel?.select) name = rel.select.name;
  const key = name.trim().toLowerCase();
  n.corso = name ? { name, color: colors.get(key) || "default" } : [];
  return n;
}

async function listNotes() {
  const { notes } = await getSources();
  return listSource(notes, "appunti");
}

async function listCorrections() {
  const { voti } = await getSources();
  if (!voti) return [];
  try {
    const colors = new Map();
    for (const n of await cached("list", listNotes)) {
      const c = Array.isArray(n.corso) ? n.corso[0] : n.corso;
      if (c?.name) colors.set(c.name.trim().toLowerCase(), c.color);
    }
    return await listSource(voti, "voti", (p, n) => enrichVoti(p, n, colors));
  } catch (e) {
    // Per esempio la fonte non ha la colonna "Pubblica": per sicurezza non si mostra nulla
    console.error(
      "Fonte voti non leggibile (nessuna correzione mostrata):",
      e.message,
    );
    return [];
  }
}

/* Restituisce la pagina solo se è PUBBLICA e viene da una delle fonti consentite (appunti o voti).
   Senza questo controllo chiunque potrebbe leggere qualsiasi pagina condivisa con l'integrazione. */
async function publishedPage(id) {
  const page = await notion(`/pages/${id}`);
  const s = await getSources();
  const par = page.parent || {};
  const parentOk = par.data_source_id
    ? s.sources.has(clean(par.data_source_id))
    : s.dbs.has(clean(par.database_id));
  const ok =
    page.properties?.[PROP.pubblica]?.checkbox === true &&
    !page.in_trash &&
    parentOk;
  if (!ok) {
    const e = new Error("Not found");
    e.status = 404;
    throw e;
  }
  return page;
}

async function noteBlocks(id) {
  const page = await publishedPage(id); // controllo Pubblica a OGNI richiesta: tolta la spunta, la nota sparisce subito
  // Si mette in cache solo il contenuto, e solo finché la pagina non viene modificata.
  return cached(`b:${id}:${page.last_edited_time}`, () => fetchBlocks(id));
}

/* Scarica un file immagine (con link a scadenza di Notion) e lo gira al browser */
async function pipeImage(src, fileName, res) {
  const up = src ? await fetch(src) : null;
  const type = up?.headers.get("content-type") || "";
  if (!up?.ok || !type.startsWith("image/")) {
    const e = new Error("Immagine non disponibile");
    e.status = 502;
    throw e;
  }
  res.writeHead(200, {
    "Content-Type": type,
    "Content-Disposition": `inline; filename="${fileName}"`,
    "Cache-Control": "private, max-age=300",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "sandbox", // un SVG aperto da solo non può eseguire script
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  });
  Readable.fromWeb(up.body).pipe(res);
}

/* Immagine di un appunto: il link è sempre fresco e "Pubblica" viene ricontrollato a ogni richiesta. */
async function noteImage(pageId, blockId, name, res) {
  const fileName = (name || "immagine").replace(/[^\w.\-]/g, "_").slice(0, 100);
  await noteBlocks(pageId); // verifica Pubblica e riempie l'indice delle immagini
  if (!imageIndex.get(clean(pageId))?.has(clean(blockId))) {
    const e = new Error("Not found");
    e.status = 404;
    throw e;
  }
  const b = await notion(`/blocks/${blockId}`);
  await pipeImage(b.image?.file?.url || b.image?.external?.url, fileName, res);
}

/* Icona della pagina, se caricata come file su Notion (la favicon della nota) */
async function noteIcon(pageId, res) {
  const page = await publishedPage(pageId);
  const ic = page.icon;
  if (ic?.type !== "file" || !ic.file?.url) {
    const e = new Error("Not found");
    e.status = 404;
    throw e;
  }
  await pipeImage(ic.file.url, "icona", res);
}

/* Icone dei corsi (le pagine collegate dalla relazione "Materia" di Voti): servono per la favicon delle pagine materia.
   Dalle righe di Voti si leggono SOLO gli ID delle pagine corso, mai voti o contenuti. */
const courseIconIds = new Set();
async function courseDataSource(voti) {
  if (process.env.NOTION_CORSI_DATA_SOURCE_ID)
    return clean(process.env.NOTION_CORSI_DATA_SOURCE_ID);
  // la colonna "Materia" di Voti è una relazione: il suo schema dice qual è il database dei corsi
  const sch = await notion(`/data_sources/${voti}`);
  const props = sch.properties || {};
  const rel =
    prop(props, "Materia")?.type === "relation"
      ? prop(props, "Materia")
      : Object.values(props).find((v) => v.type === "relation");
  return rel?.relation?.data_source_id || null;
}
async function listCourseIcons() {
  const { voti } = await getSources();
  const out = {};
  try {
    let pages = [];
    const ds = voti
      ? await courseDataSource(voti).catch(
          (e) => (
            console.error("Schema di Voti non leggibile:", e.message),
            null
          ),
        )
      : null;
    if (ds) {
      // L'ID può essere quello del database (quello che si vede nell'URL) o della sua fonte dati: si prova prima come database
      const sources = await notion(`/databases/${ds}`)
        .then((d) => (d.data_sources || []).map((x) => x.id))
        .catch(() => [ds]);
      // TUTTI i corsi del database (anche quelli senza voti): servono solo nome e icona
      for (const id of sources.length ? sources : [ds]) {
        let cursor;
        do {
          const r = await notion(`/data_sources/${id}/query`, {
            method: "POST",
            body: { page_size: 100, ...(cursor && { start_cursor: cursor }) },
          });
          pages.push(...r.results);
          cursor = r.has_more ? r.next_cursor : null;
        } while (cursor);
      }
    } else if (voti) {
      // ripiego: solo i corsi che compaiono nelle righe di Voti
      const ids = new Set();
      let cursor;
      do {
        const r = await notion(`/data_sources/${voti}/query`, {
          method: "POST",
          body: { page_size: 100, ...(cursor && { start_cursor: cursor }) },
        });
        for (const pg of r.results) {
          const props = pg.properties || {};
          const rel =
            prop(props, "Materia") ||
            Object.values(props).find((v) => v.type === "relation");
          (rel?.relation || []).forEach((x) => ids.add(x.id));
        }
        cursor = r.has_more ? r.next_cursor : null;
      } while (cursor);
      for (const id of ids)
        pages.push(await cached(`rel:${id}`, () => notion(`/pages/${id}`)));
    }
    for (const pg of pages) {
      if (pg.object !== "page" || pg.in_trash) continue;
      const k = Object.keys(pg.properties || {}).find(
        (x) => pg.properties[x].type === "title",
      );
      const name = plain(pg.properties[k]?.title).trim().toLowerCase();
      const icon = mapIcon(pg, "/api/course-icon/");
      if (name && icon) {
        out[name] = icon;
        courseIconIds.add(clean(pg.id));
      }
    }
  } catch (e) {
    console.error("Icone dei corsi non leggibili:", e.message);
  }
  console.log(
    "Icone dei corsi trovate:",
    Object.keys(out).join(", ") || "nessuna",
  );
  return out;
}
async function courseIcon(pageId, res) {
  await cached("courseicons", listCourseIcons);
  const bad = () => Object.assign(new Error("Not found"), { status: 404 });
  if (!courseIconIds.has(clean(pageId))) throw bad(); // solo pagine corso già individuate
  const pg = await notion(`/pages/${pageId}`);
  if (pg.icon?.type !== "file" || !pg.icon.file?.url) throw bad();
  await pipeImage(pg.icon.file.url, "icona", res);
}

/* ---------- Server HTTP ---------- */
const send = (res, code, body, type = "application/json") => {
  res.writeHead(code, {
    "Content-Type": type + "; charset=utf-8",
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Cache-Control": "no-cache",
  });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
};

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    try {
      if (req.method === "OPTIONS") return send(res, 204, "");
      if (req.method !== "GET")
        return send(res, 405, { error: "Method not allowed" });

      if (url.pathname === "/api/notes")
        return send(res, 200, await cached("list", listNotes));

      if (url.pathname === "/api/course-icons")
        return send(res, 200, await cached("courseicons", listCourseIcons));

      const ci = url.pathname.match(
        /^\/api\/course-icon\/([0-9a-f-]{32,36})\/icon$/i,
      );
      if (ci) return await courseIcon(ci[1], res);

      if (url.pathname === "/api/corrections")
        return send(res, 200, await cached("corrections", listCorrections));

      const ic = url.pathname.match(
        /^\/api\/notes\/([0-9a-f-]{32,36})\/icon$/i,
      );
      if (ic) return await noteIcon(ic[1], res);

      const im = url.pathname.match(
        /^\/api\/notes\/([0-9a-f-]{32,36})\/img\/([0-9a-f-]{32,36})(?:\/([^/]*))?$/i,
      );
      if (im) return await noteImage(im[1], im[2], im[3], res);

      const m = url.pathname.match(
        /^\/api\/notes\/([0-9a-f-]{32,36})\/blocks$/i,
      );
      if (m) return send(res, 200, await noteBlocks(m[1]));

      if (url.pathname === "/" || url.pathname === "/appunti.html") {
        return send(
          res,
          200,
          fs.readFileSync(path.join(__dirname, "appunti.html"), "utf8"),
          "text/html",
        );
      }
      send(res, 404, { error: "Not found" });
    } catch (e) {
      console.error(e.message);
      send(res, e.status === 404 ? 404 : 502, {
        error: e.status === 404 ? "Not found" : "Errore Notion",
      });
    }
  })
  .listen(PORT, process.env.HOST || "127.0.0.1", () =>
    console.log(`Server pronto su http://127.0.0.1:${PORT}`),
  ); // solo locale: ci pensa Nginx a esporlo
