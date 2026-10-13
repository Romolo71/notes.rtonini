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
     GET /api/notes               lista appunti con Pubblica = true
     GET /api/notes/:id/blocks    contenuto di un appunto (solo se pubblico)
     GET /                        serve appunti.html (comodo in locale)
   ===================================================================== */
const http = require("http");
const fs = require("fs");
const path = require("path");

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
  corso: "Corso",
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

function mapPage(page) {
  const p = page.properties;
  const corsoProp = p[PROP.corso];
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
  const a = p[PROP.autore];
  const autore = a?.people
    ? a.people.map((u) => u.name).filter(Boolean)
    : a?.rich_text
      ? plain(a.rich_text)
      : a?.created_by
        ? [a.created_by.name].filter(Boolean)
        : [];
  const d = p[PROP.data];
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

function mapBlock(b) {
  if (b.type === "divider") return { type: "divider" };
  if (b.type === "heading_4")
    return { type: "heading_3", rich_text: b.heading_4.rich_text };
  if (!SUPPORTED.has(b.type)) return null; // immagini, tabelle, embed… non gestiti dal frontend
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

async function fetchBlocks(blockId, depth = 0) {
  const out = [];
  let cursor;
  do {
    const q = `?page_size=100${cursor ? `&start_cursor=${cursor}` : ""}`;
    const r = await notion(`/blocks/${blockId}/children${q}`);
    for (const b of r.results) {
      const m = mapBlock(b);
      if (m) out.push(m);
      // I blocchi annidati (toggle, sotto-elenchi, colonne) richiedono una chiamata a parte
      if (
        b.has_children &&
        depth < 3 &&
        !["child_page", "child_database"].includes(b.type)
      ) {
        out.push(...(await fetchBlocks(b.id, depth + 1)));
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
  return fetchBlocks(id);
}

/* ---------- Server HTTP ---------- */
const send = (res, code, body, type = "application/json") => {
  res.writeHead(code, {
    "Content-Type": type + "; charset=utf-8",
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Cache-Control": "public, max-age=30",
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

      const m = url.pathname.match(
        /^\/api\/notes\/([0-9a-f-]{32,36})\/blocks$/i,
      );
      if (m)
        return send(
          res,
          200,
          await cached("b:" + m[1], () => noteBlocks(m[1])),
        );

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
