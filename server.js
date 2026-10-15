/* =====================================================================
   Backend Node.js per "Appunti Universitari"  ->  Notion API
   Nessuna dipendenza: serve Node 18+ (fetch e http sono già inclusi).

   AVVIO
     NOTION_TOKEN=secret_xxx NOTION_DATABASE_ID=xxxxxxxx node server.js

   VARIABILI D'AMBIENTE
     NOTION_TOKEN          (obbligatoria) token della tua integrazione Notion
     NOTION_DATABASE_ID    (obbligatoria) ID del database degli appunti
     NOTION_DATA_SOURCE_ID (opzionale) se lo conosci, salta la ricerca automatica
     PORT                  (default 3000)
     ALLOWED_ORIGIN        (default *) dominio del sito che chiama l'API
     CACHE_SECONDS         (default 60)

   ENDPOINT
     GET /api/notes                      lista appunti con Pubblica = true
     GET /api/notes/:id/blocks           contenuto di un appunto (solo se pubblico)
     GET /api/notes/:id/img/:blockId     immagine di un appunto (solo se pubblico)
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

/* ---------- Database -> data source ---------- */
let dataSourceId = NOTION_DATA_SOURCE_ID || null;
async function getDataSourceId() {
  if (dataSourceId) return dataSourceId;
  const db = await notion(`/databases/${NOTION_DATABASE_ID}`);
  dataSourceId = db.data_sources?.[0]?.id;
  if (!dataSourceId)
    throw new Error(
      "Nessun data source trovato: imposta NOTION_DATA_SOURCE_ID.",
    );
  return dataSourceId;
}

/* ---------- Conversione proprietà Notion -> formato del frontend ---------- */
const plain = (rt = []) => rt.map((t) => t.plain_text).join("");
// Trova una colonna per nome ignorando maiuscole/minuscole e spazi ("class" = "Class" = " class ")
const prop = (p, name) =>
  p[name] ??
  p[Object.keys(p).find((k) => k.trim().toLowerCase() === name.toLowerCase())];

function mapPage(page) {
  const p = page.properties;
  const corsoProp = prop(p, PROP.corso);
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
  };
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
      .replace(/[\u0300-\u036f]/g, "")
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
  // Formula a tutta riga (Notion la scrive in KaTeX; il disegno lo fa il frontend)
  if (b.type === "equation")
    return { type: "equation", expression: b.equation.expression };
  if (!SUPPORTED.has(b.type)) return null; // embed, video… non ancora gestiti
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

// Tutti i figli di un blocco (gestisce la paginazione di Notion)
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
  let cursor;
  do {
    const q = `?page_size=100${cursor ? `&start_cursor=${cursor}` : ""}`;
    const r = await notion(`/blocks/${blockId}/children${q}`);
    for (const b of r.results) {
      // Tabella: le righe sono blocchi figli, ognuna con le sue celle (liste di testo formattato)
      if (b.type === "table") {
        const rows = await listChildren(b.id);
        out.push({
          type: "table",
          columnHeader: b.table.has_column_header,
          rowHeader: b.table.has_row_header,
          rows: rows
            .filter((x) => x.type === "table_row")
            .map((x) => x.table_row.cells),
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
    cursor = r.has_more ? r.next_cursor : null;
  } while (cursor);
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
async function listNotes() {
  const ds = await getDataSourceId();
  const results = [];
  let cursor;
  do {
    const r = await notion(`/data_sources/${ds}/query`, {
      method: "POST",
      body: {
        // Il filtro sta QUI, lato server: le note non pubbliche non lasciano mai Notion
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
      "Colonne trovate:",
      Object.entries(results[0].properties)
        .map(([k, v]) => `"${k}" (${v.type})`)
        .join(", "),
    );
  return results
    .filter((p) => p.object === "page" && !p.in_trash)
    .map(mapPage)
    .filter((n) => n.pubblica);
}

async function noteBlocks(id) {
  // Sicurezza: prima di restituire il contenuto verifica che la pagina sia
  // davvero del tuo database e abbia Pubblica = true. Senza questo controllo
  // chiunque potrebbe leggere qualsiasi pagina condivisa con l'integrazione.
  const page = await notion(`/pages/${id}`);
  const parentDb = clean(page.parent?.database_id);
  const ok =
    page.properties?.[PROP.pubblica]?.checkbox === true &&
    !page.in_trash &&
    parentDb === clean(NOTION_DATABASE_ID);
  if (!ok) {
    const e = new Error("Not found");
    e.status = 404;
    throw e;
  }
  // Il controllo qui sopra avviene SEMPRE (1 chiamata leggera): se togli "Pubblica" la nota sparisce subito.
  // Si mette in cache solo il contenuto, e solo finché la pagina non viene modificata.
  return cached(`b:${id}:${page.last_edited_time}`, () => fetchBlocks(id));
}

/* Scarica un'immagine di Notion e la gira al browser:
   il link è sempre fresco e "Pubblica" viene ricontrollato a ogni richiesta. */
async function noteImage(pageId, blockId, name, res) {
  const fileName = (name || "immagine").replace(/[^\w.\-]/g, "_").slice(0, 100);
  await noteBlocks(pageId); // verifica Pubblica e riempie l'indice delle immagini
  if (!imageIndex.get(clean(pageId))?.has(clean(blockId))) {
    const e = new Error("Not found");
    e.status = 404;
    throw e;
  }
  const b = await notion(`/blocks/${blockId}`);
  const src = b.image?.file?.url || b.image?.external?.url;
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
