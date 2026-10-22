/* =====================================================================
   CONFIGURAZIONE BACKEND
   ---------------------------------------------------------------------
   Imposta API_BASE con l'URL del tuo server Node.js (es. 'https://api.miosito.it').
   Con API_BASE = '' vengono usati i dati mock.

   Contratti attesi (JSON):
   GET  {API_BASE}/api/notes
     -> [ { id, titolo, pubblica,
            corso: { name: "Basi di Dati", color: "green" }      (Select di Notion, passato così com'è)
                   | [ { name, color }, ... ]                    (Multi-select)
                   | "Basi di Dati" | ["Basi di Dati"]           (solo nome: colore automatico),
            autore: "Nome" | ["Nome"], dataCreazione: ISO8601, url?: notionUrl,
            blocks?: [...] } ]
   GET  {API_BASE}/api/notes/:id/blocks   (opzionale, caricato all'apertura)
     -> [ blocchi Notion (heading_1/2/3, paragraph, bulleted_list_item,
          numbered_list_item, to_do, quote, callout, code, divider, image, equation, table) ]

   GET  {API_BASE}/api/corrections        (correzioni dalla fonte "voti", stesso formato di /api/notes)
   Ogni nota può avere icon: { type: "emoji", emoji } | { type: "url", url } (la favicon della nota).

   Il backend dovrebbe già filtrare Pubblica = true; il client lo
   ri-verifica comunque in modo rigido.
   ===================================================================== */
// In produzione (https) chiama il backend dello stesso dominio, via Nginx su /api/.
// Aprendo il file in locale (file://) usa invece i dati di esempio.
const LOCAL_FILE = location.protocol === "file:";
const API_BASE = LOCAL_FILE ? "" : location.origin;
const USE_MOCK_FALLBACK = LOCAL_FILE; // online, se il backend non risponde mostra l'errore: mai dati finti

/* ---------- Dati mock (formato blocchi Notion semplificato) ---------- */
const T = (text, a = {}) => ({
  plain_text: text,
  annotations: a,
  href: a.href || null,
});
const P = (...rt) => ({ type: "paragraph", rich_text: rt });
const H = (n, s) => ({ type: "heading_" + n, rich_text: [T(s)] });
const LI = (...rt) => ({ type: "bulleted_list_item", rich_text: rt });
const NI = (...rt) => ({ type: "numbered_list_item", rich_text: rt });

const COURSE_INFO = {
  "Sistemi e Reti": {
    docenti: [
      { ruolo: "Teoria", nome: "Sergio Mattiello" },
      { ruolo: "Laboratorio", nome: "Andrea Funes Nova" },
    ],
  },
  Informatica: {
    docenti: [
      { ruolo: "Teoria", nome: "Francesco D'Este" },
      { ruolo: "Laboratorio", nome: "Stefano Giacomello" },
    ],
  },
  Tpsit: {
    docenti: [
      { ruolo: "Teoria", nome: "Marco Tramontini" },
      { ruolo: "Laboratorio", nome: "Andrea Funes Nova" },
    ],
  },
  GPOI: {
    docenti: [
      { ruolo: "Teoria", nome: "Marco Begolo" },
      { ruolo: "Laboratorio", nome: "Daniele Dentico" },
    ],
  },
  Matematica: { docenti: [{ nome: "Federica Paiaro" }] },
  Italiano: { docenti: [{ nome: "Lorenzo De Rossi" }] },
  Storia: { docenti: [{ nome: "Lorenzo De Rossi" }] },
  Inglese: { docenti: [{ nome: "Graziella Viglietti" }] },
  "Scienze Motorie": { docenti: [{ nome: "Eros Del Giudice" }] },
  Religione: { docenti: [{ nome: "Fabiana Saccon" }] },
};

const MOCK_NOTES = [
  {
    id: "n1",
    titolo: "Limiti e continuità: guida completa",
    pubblica: true,
    corso: { name: "Analisi Matematica I", color: "blue" },
    autore: "Giulia Rossi",
    dataCreazione: "2026-10-08T10:12:00Z",
    icon: { type: "emoji", emoji: "📐" },
    url: "https://notion.so/",
    blocks: [
      P(
        T(
          "I limiti sono il fondamento di tutta l'analisi: descrivono il comportamento di una funzione ",
        ),
        T("vicino", { italic: true }),
        T(
          " a un punto, senza richiedere che la funzione sia definita nel punto stesso.",
        ),
      ),
      H(2, "Definizione di limite"),
      P(
        T("Si dice che "),
        T("lim x→x₀ f(x) = L", { code: true }),
        T(
          " se per ogni ε > 0 esiste un δ > 0 tale che |f(x) − L| < ε per ogni x con 0 < |x − x₀| < δ.",
        ),
      ),
      {
        type: "callout",
        icon: "💡",
        rich_text: [
          T("Intuizione: ", { bold: true }),
          T(
            "puoi rendere f(x) vicina quanto vuoi a L, purché x sia abbastanza vicino a x₀.",
          ),
        ],
      },
      H(2, "Limiti notevoli"),
      LI(T("sin(x)/x → 1", { code: true }), T(" per x → 0")),
      LI(T("(1 − cos x)/x² → 1/2", { code: true }), T(" per x → 0")),
      LI(T("(1 + 1/x)ˣ → e", { code: true }), T(" per x → ∞")),
      LI(T("(eˣ − 1)/x → 1", { code: true }), T(" per x → 0")),
      H(2, "Continuità"),
      P(
        T("Una funzione f è "),
        T("continua", { bold: true }),
        T(" in x₀ se lim f(x) = f(x₀). Esistono tre tipi di discontinuità:"),
      ),
      NI(
        T("Eliminabile", { bold: true }),
        T(" — il limite esiste ma differisce dal valore (o f non è definita)."),
      ),
      NI(
        T("Di salto", { bold: true }),
        T(" — limite destro e sinistro esistono finiti ma diversi."),
      ),
      NI(
        T("Essenziale", { bold: true }),
        T(" — almeno uno dei limiti laterali è infinito o non esiste."),
      ),
      {
        type: "quote",
        rich_text: [
          T(
            "Teorema di Weierstrass: una funzione continua su un intervallo chiuso e limitato ammette massimo e minimo.",
          ),
        ],
      },
      { type: "divider" },
      H(3, "Da ripassare prima dell'esame"),
      { type: "to_do", checked: true, rich_text: [T("Limiti notevoli")] },
      {
        type: "to_do",
        checked: true,
        rich_text: [T("Teorema dei due carabinieri")],
      },
      {
        type: "to_do",
        checked: false,
        rich_text: [T("Teorema degli zeri — esercizi")],
      },
    ],
  },
  {
    id: "n2",
    titolo: "Normalizzazione: 1NF, 2NF, 3NF e BCNF",
    pubblica: true,
    corso: { name: "Basi di Dati", color: "green" },
    autore: "Marco Bianchi",
    dataCreazione: "2026-10-05T16:40:00Z",
    url: "https://notion.so/",
    blocks: [
      P(
        T(
          "La normalizzazione è il processo con cui si organizza uno schema relazionale per ridurre la ",
        ),
        T("ridondanza", { bold: true }),
        T(" ed evitare anomalie di inserimento, modifica e cancellazione."),
      ),
      H(2, "Dipendenze funzionali"),
      P(
        T(
          "X → Y significa che il valore di X determina univocamente il valore di Y. Il concetto di ",
        ),
        T("chiusura", { italic: true }),
        T(" X⁺ è lo strumento chiave per trovare le chiavi di una relazione."),
      ),
      H(2, "Forme normali"),
      NI(T("1NF", { bold: true }), T(" — tutti gli attributi sono atomici.")),
      NI(
        T("2NF", { bold: true }),
        T(" — 1NF + nessuna dipendenza parziale dalla chiave."),
      ),
      NI(
        T("3NF", { bold: true }),
        T(" — 2NF + nessuna dipendenza transitiva."),
      ),
      NI(
        T("BCNF", { bold: true }),
        T(" — per ogni X → Y non banale, X è una superchiave."),
      ),
      {
        type: "callout",
        icon: "⚠️",
        rich_text: [
          T("Attenzione: ", { bold: true }),
          T(
            "la decomposizione in BCNF può far perdere dipendenze funzionali; la 3NF garantisce invece decomposizione senza perdita e con conservazione.",
          ),
        ],
      },
      H(2, "Esempio SQL"),
      {
        type: "code",
        language: "sql",
        rich_text: [
          T(
            "SELECT c.nome, COUNT(e.id) AS esami\nFROM corsi c\nLEFT JOIN esami e ON e.corso_id = c.id\nGROUP BY c.nome\nHAVING COUNT(e.id) > 3\nORDER BY esami DESC;",
          ),
        ],
      },
    ],
  },
  {
    id: "n3",
    titolo: "Primo principio della termodinamica",
    pubblica: true,
    corso: { name: "Fisica Tecnica", color: "orange" },
    autore: "Sara Conti",
    dataCreazione: "2026-09-29T09:05:00Z",
    url: "https://notion.so/",
    blocks: [
      P(
        T(
          "L'energia non si crea né si distrugge: si trasforma. Per un sistema chiuso, la variazione di energia interna è pari al calore scambiato meno il lavoro compiuto.",
        ),
      ),
      { type: "code", language: "text", rich_text: [T("ΔU = Q − L")] },
      H(2, "Convenzioni sui segni"),
      LI(T("Q > 0", { code: true }), T(" → calore ceduto al sistema")),
      LI(T("L > 0", { code: true }), T(" → lavoro compiuto dal sistema")),
      H(2, "Trasformazioni principali"),
      LI(
        T("Isoterma", { bold: true }),
        T(" — T costante, ΔU = 0 per un gas ideale"),
      ),
      LI(T("Isobara", { bold: true }), T(" — P costante, Q = ΔH")),
      LI(T("Isocora", { bold: true }), T(" — V costante, L = 0")),
      LI(T("Adiabatica", { bold: true }), T(" — Q = 0")),
      {
        type: "callout",
        icon: "🔥",
        rich_text: [
          T(
            "In ingegneria si lavora spesso con l'entalpia H = U + pV, che semplifica i bilanci nei sistemi aperti.",
          ),
        ],
      },
    ],
  },
  {
    id: "n4",
    titolo: "Derivate e studio di funzione",
    pubblica: true,
    corso: { name: "Analisi Matematica I", color: "blue" },
    autore: "Giulia Rossi",
    dataCreazione: "2026-10-11T18:22:00Z",
    url: "https://notion.so/",
    blocks: [
      P(
        T(
          "La derivata misura la velocità di variazione istantanea di una funzione ed è il coefficiente angolare della retta tangente al grafico.",
        ),
      ),
      H(2, "Regole di derivazione"),
      LI(T("(f·g)′ = f′g + fg′", { code: true })),
      LI(T("(f/g)′ = (f′g − fg′)/g²", { code: true })),
      LI(T("(f∘g)′ = f′(g(x))·g′(x)", { code: true })),
      H(2, "Schema di studio di funzione"),
      NI(T("Dominio e simmetrie")),
      NI(T("Segno e intersezioni con gli assi")),
      NI(T("Limiti agli estremi e asintoti")),
      NI(T("Derivata prima: monotonia ed estremanti")),
      NI(T("Derivata seconda: convessità e flessi")),
    ],
  },
  {
    id: "n5",
    titolo: "Transazioni e controllo della concorrenza",
    pubblica: true,
    corso: { name: "Basi di Dati", color: "green" },
    autore: "Luca Ferri",
    dataCreazione: "2026-10-12T08:30:00Z",
    url: "https://notion.so/",
    blocks: [
      P(
        T(
          "Una transazione è un'unità logica di lavoro che deve rispettare le proprietà ",
        ),
        T("ACID", { bold: true }),
        T("."),
      ),
      LI(T("Atomicità", { bold: true }), T(" — tutto o niente")),
      LI(T("Consistenza", { bold: true }), T(" — vincoli sempre rispettati")),
      LI(
        T("Isolamento", { bold: true }),
        T(" — transazioni concorrenti non interferiscono"),
      ),
      LI(
        T("Durabilità", { bold: true }),
        T(" — gli effetti del commit sono permanenti"),
      ),
      H(2, "Two-Phase Locking (2PL)"),
      P(
        T(
          "Nel 2PL una transazione acquisisce tutti i lock in una fase di crescita e li rilascia in una fase di decrescita. Garantisce la serializzabilità ma può causare ",
        ),
        T("deadlock", { italic: true }),
        T("."),
      ),
    ],
  },
  {
    id: "n6",
    titolo: "Conduzione, convezione e irraggiamento",
    pubblica: true,
    corso: { name: "Fisica Tecnica", color: "orange" },
    autore: "Sara Conti",
    dataCreazione: "2026-10-02T14:15:00Z",
    url: "https://notion.so/",
    blocks: [
      P(
        T(
          "Il calore si trasmette in tre modi: per contatto diretto (conduzione), tramite il moto di un fluido (convezione) e per onde elettromagnetiche (irraggiamento).",
        ),
      ),
      H(2, "Legge di Fourier"),
      {
        type: "code",
        language: "text",
        rich_text: [T("q = −λ · A · (dT/dx)")],
      },
      H(2, "Legge di Stefan–Boltzmann"),
      {
        type: "code",
        language: "text",
        rich_text: [T("E = ε · σ · T⁴      σ = 5,67·10⁻⁸ W/(m²·K⁴)")],
      },
    ],
  },
  {
    id: "n7",
    titolo: "Algoritmi di ordinamento: confronto",
    pubblica: true,
    corso: { name: "Algoritmi e Strutture Dati", color: "purple" },
    autore: "Marco Bianchi",
    dataCreazione: "2026-09-21T11:00:00Z",
    url: "https://notion.so/",
    blocks: [
      P(
        T(
          "Confronto tra i principali algoritmi di ordinamento per complessità temporale e spaziale.",
        ),
      ),
      LI(
        T("Merge sort", { bold: true }),
        T(" — O(n log n) sempre, O(n) di spazio extra"),
      ),
      LI(
        T("Quick sort", { bold: true }),
        T(" — O(n log n) medio, O(n²) nel caso peggiore"),
      ),
      LI(
        T("Heap sort", { bold: true }),
        T(" — O(n log n), in place, non stabile"),
      ),
      {
        type: "callout",
        icon: "📌",
        rich_text: [
          T(
            "Nessun algoritmo basato su confronti può fare meglio di Ω(n log n) nel caso peggiore.",
          ),
        ],
      },
      {
        type: "code",
        language: "js",
        rich_text: [
          T(
            "function quick(a) {\n  if (a.length < 2) return a;\n  const [p, ...r] = a;\n  return [...quick(r.filter(x => x < p)), p, ...quick(r.filter(x => x >= p))];\n}",
          ),
        ],
      },
    ],
  },
  {
    id: "n8",
    titolo: "Alberi binari di ricerca e AVL",
    pubblica: true,
    corso: { name: "Algoritmi e Strutture Dati", color: "purple" },
    autore: "Luca Ferri",
    dataCreazione: "2026-10-09T19:45:00Z",
    url: "https://notion.so/",
    blocks: [
      P(
        T(
          "Un BST mantiene la proprietà: i nodi a sinistra sono minori, quelli a destra maggiori. Gli alberi AVL aggiungono un vincolo di bilanciamento: la differenza di altezza tra i sottoalberi è al massimo 1.",
        ),
      ),
      H(2, "Rotazioni"),
      LI(T("Semplice destra / sinistra")),
      LI(T("Doppia sinistra-destra / destra-sinistra")),
    ],
  },
  {
    id: "n9",
    titolo: "Bozza privata — non condividere",
    pubblica: false,
    corso: { name: "Basi di Dati", color: "green" },
    autore: "Marco Bianchi",
    dataCreazione: "2026-10-13T07:00:00Z",
    url: "",
    blocks: [P(T("Questa pagina NON deve apparire: Pubblica è false."))],
  },
  {
    id: "n10",
    titolo: "Appunti personali esame — ignorare",
    pubblica: false,
    corso: { name: "Fisica Tecnica", color: "orange" },
    autore: "Sara Conti",
    dataCreazione: "2026-10-10T07:00:00Z",
    url: "",
    blocks: [P(T("Neanche questa deve apparire."))],
  },
];

/* Correzioni di esempio (in produzione arrivano da /api/corrections, fonte "voti") */
const MOCK_CORRECTIONS = [
  {
    id: "c1",
    titolo: "Correzione verifica: limiti e derivate",
    pubblica: true,
    corso: { name: "Analisi Matematica I", color: "blue" },
    autore: "Giulia Rossi",
    dataCreazione: "2026-10-14T09:00:00Z",
    icon: { type: "emoji", emoji: "✅" },
    blocks: [
      H(2, "Esercizio 1"),
      P(T("Si applica il limite notevole "), T("sin(x)/x → 1", { code: true }), T(".")),
      H(2, "Esercizio 2"),
      LI(T("Derivata del prodotto")),
      LI(T("Studio del segno")),
    ],
  },
  {
    id: "c2",
    titolo: "Correzione verifica: derivate e studio di funzione",
    pubblica: true,
    corso: { name: "Analisi Matematica I", color: "blue" },
    autore: "Giulia Rossi",
    dataCreazione: "2026-10-18T09:00:00Z",
    blocks: [P(T("Svolgimento completo dell'esercizio sullo studio di funzione."))],
  },
  {
    id: "c3",
    titolo: "Correzione verifica: normalizzazione",
    pubblica: true,
    corso: { name: "Basi di Dati", color: "green" },
    autore: "Marco Bianchi",
    dataCreazione: "2026-10-16T09:00:00Z",
    blocks: [P(T("Decomposizione in 3NF e verifica della conservazione delle dipendenze."))],
  },
];

/* Icone dei corsi di esempio (in produzione da /api/course-icons: pagine corso di Notion) */
const MOCK_COURSE_ICONS = { "analisi matematica i": { type: "emoji", emoji: "📊" } };

/* ---------- Stato ---------- */
const state = {
  corrections: [],
  notes: [],
  course: "ALL",
  query: "",
  courseIcons: {},
  sort: "new", // ordine di visualizzazione (predefinito: più recenti prima)
  sortOpen: false,
  loading: true,
  source: "mock",
};
const $ = (s) => document.querySelector(s);

/* ---------- Utility ---------- */
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const norm = (s) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
const arr = (v) =>
  (Array.isArray(v) ? v : v ? [v] : [])
    .map((x) => (typeof x === "object" ? x.name : x))
    .filter(Boolean);
const fmtDate = (iso) => {
  const d = new Date(iso);
  return isNaN(d)
    ? "—"
    : d.toLocaleDateString("it-IT", {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
};
const fmtDateLong = (iso) => {
  const d = new Date(iso);
  return isNaN(d)
    ? "—"
    : d.toLocaleDateString("it-IT", {
        day: "numeric",
        month: "long",
        year: "numeric",
      });
};
const initials = (n) =>
  n
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

/* Colore deterministico per corso */
/* Colori di Notion -> [tinta, saturazione]. Sono i 10 colori standard delle opzioni Select. */
const NOTION_COLORS = {
  default: [215, 12],
  gray: [215, 12],
  brown: [28, 45],
  orange: [25, 90],
  yellow: [48, 90],
  green: [150, 70],
  blue: [215, 90],
  purple: [270, 80],
  pink: [330, 80],
  red: [0, 85],
};
const courseColors = {}; // nome corso -> nome colore Notion (riempito in normalize)
const HUES = [239, 160, 25, 330, 190, 48, 280, 8, 120, 210]; // fallback se Notion non fornisce il colore
const hashHue = (name) => {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return HUES[h % HUES.length];
};
const courseStyle = (name) =>
  NOTION_COLORS[courseColors[name]] || [hashHue(name), 85];
const col = (name, l = 70) => {
  const [h, s] = courseStyle(name);
  return `hsl(${h} ${s}% ${l}%)`;
};
const colA = (name, a) => {
  const [h, s] = courseStyle(name);
  return `hsl(${h} ${s}% 65% / ${a})`;
};

const badge = (name) =>
  `<span class="pr-badge inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold tracking-wide" style="color:${col(name, 74)};background:${colA(name, 0.12)};box-shadow:inset 0 0 0 1px ${colA(name, 0.25)}"><i class="h-1.5 w-1.5 rounded-full" style="background:${col(name, 65)}"></i>${esc(name)}</span>`;

const highlight = (text, q) => {
  const safe = esc(text);
  if (!q) return safe;
  const words = norm(q).split(/\s+/).filter(Boolean);
  if (!words.length) return safe;
  const n = norm(text);
  const ranges = [];
  words.forEach((w) => {
    let i = n.indexOf(w);
    while (i !== -1) {
      ranges.push([i, i + w.length]);
      i = n.indexOf(w, i + w.length);
    }
  });
  if (!ranges.length) return safe;
  ranges.sort((a, b) => a[0] - b[0]);
  const merged = [];
  ranges.forEach((r) => {
    const l = merged[merged.length - 1];
    if (l && r[0] <= l[1]) l[1] = Math.max(l[1], r[1]);
    else merged.push([...r]);
  });
  let out = "",
    last = 0;
  merged.forEach(([s, e]) => {
    out +=
      esc(text.slice(last, s)) +
      '<mark class="hl">' +
      esc(text.slice(s, e)) +
      "</mark>";
    last = e;
  });
  return out + esc(text.slice(last));
};

/* ---------- Caricamento dati ---------- */
function normalize(r) {
  // Se il corso arriva come oggetto Notion { name, color } (o array di questi), salva il colore
  [].concat(r.corso ?? r.corsi ?? []).forEach((c) => {
    if (c && typeof c === "object" && c.name && c.color)
      courseColors[c.name] = c.color;
  });
  return {
    id: r.id,
    titolo: (r.titolo ?? r.title ?? "Senza titolo").trim(),
    pubblica: r.pubblica === true, // rigido: solo true
    corsi: arr(r.corso ?? r.corsi).length
      ? arr(r.corso ?? r.corsi)
      : ["Senza corso"],
    autore: arr(r.autore).join(", ") || "Anonimo",
    data: r.dataCreazione ?? r.created_time ?? r.data,
    url: r.url || "",
    blocks: r.blocks || null,
    icon: r.icon || null,
  };
}

async function loadNotes() {
  state.loading = true;
  render();
  let raw;
  try {
    if (!API_BASE) throw new Error("mock");
    const res = await fetch(`${API_BASE}/api/notes`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    raw = await res.json();
    state.source = "live";
  } catch (e) {
    if (!USE_MOCK_FALLBACK) {
      state.notes = [];
      state.loading = false;
      state.source = "error";
      render();
      return;
    }
    await new Promise((r) => setTimeout(r, 650)); // simula latenza di rete
    raw = MOCK_NOTES;
    state.source = API_BASE ? "fallback" : "mock";
  }
  state.notes = raw
    .map(normalize)
    .filter((n) => n.pubblica === true)
    .sort((a, b) => new Date(b.data) - new Date(a.data));
  state.loading = false;
  render();
  loadCourseIcons();
  loadCorrections(); // non blocca gli appunti: se la fonte "voti" non risponde, semplicemente non compare la sezione
}

async function loadCourseIcons() {
  let raw = {};
  try {
    if (!API_BASE) raw = MOCK_COURSE_ICONS;
    else {
      const res = await fetch(`${API_BASE}/api/course-icons`, { headers: { Accept: "application/json" } });
      if (res.ok) raw = await res.json();
    }
  } catch {}
  state.courseIcons = Object.fromEntries(Object.entries(raw).map(([k, v]) => [norm(k), v]));
  render();
}

async function loadCorrections() {
  let raw = [];
  try {
    if (!API_BASE) raw = MOCK_CORRECTIONS;
    else {
      const res = await fetch(`${API_BASE}/api/corrections`, {
        headers: { Accept: "application/json" },
      });
      if (res.ok) raw = await res.json();
    }
  } catch {}
  state.corrections = raw
    .map(normalize)
    .filter((n) => n.pubblica === true)
    .sort((a, b) => new Date(b.data) - new Date(a.data));
  render();
}

async function loadBlocks(note) {
  if (note.blocks) return note.blocks;
  try {
    const res = await fetch(
      `${API_BASE}/api/notes/${encodeURIComponent(note.id)}/blocks`,
    );
    if (!res.ok) throw 0;
    note.blocks = await res.json();
  } catch {
    note.blocks = [
      {
        type: "paragraph",
        rich_text: [T("Impossibile caricare il contenuto della nota.")],
      },
    ];
  }
  return note.blocks;
}

/* ---------- Derivati ---------- */
function courseList() {
  const m = new Map();
  state.notes.forEach((n) =>
    n.corsi.forEach((c) => m.set(c, (m.get(c) || 0) + 1)),
  );
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], "it"));
}
/* Ordinamenti disponibili: quello attivo non compare nel menu */
const SORTS = {
  new: { short: "Più recenti", label: "Per data di creazione (più recente - meno recente)" },
  old: { short: "Meno recenti", label: "Per data di creazione (meno recente - più recente)" },
  az: { short: "Nome A-Z", label: "Per nome (A-Z)" },
  za: { short: "Nome Z-A", label: "Per nome (Z-A)" },
};
function sorted(list) {
  const byName = (a, b) =>
    a.titolo.localeCompare(b.titolo, "it", { numeric: true, sensitivity: "base" });
  const d = (n) => new Date(n.data).getTime() || 0;
  const f = {
    new: (a, b) => d(b) - d(a),
    old: (a, b) => d(a) - d(b),
    az: byName,
    za: (a, b) => byName(b, a),
  }[state.sort];
  return [...list].sort(f);
}
function sortHTML() {
  if (state.loading) return "";
  const items = Object.entries(SORTS)
    .filter(([k]) => k !== state.sort)
    .map(
      ([k, v]) =>
        `<button type="button" role="menuitem" data-sort="${k}" class="block w-full text-left px-3.5 py-2 text-[13px] text-slate-200 hover:bg-white/10 transition">${v.label}</button>`,
    )
    .join("");
  return `<div class="relative inline-block">
    <button id="sortBtn" type="button" aria-haspopup="menu" aria-expanded="${state.sortOpen}" class="inline-flex items-center gap-2 rounded-full bg-white/[0.06] px-3.5 py-1.5 text-xs font-semibold text-slate-200 ring-1 ring-white/10 transition hover:bg-white/10">
      <svg class="h-3.5 w-3.5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M3 7h13M3 12h9M3 17h5m8-1 3 3m0 0 3-3m-3 3V9"/></svg>
      Ordina: ${SORTS[state.sort].short}
    </button>
    ${state.sortOpen ? `<div role="menu" class="absolute left-0 top-full z-30 mt-2 w-72 overflow-hidden rounded-xl border border-white/10 bg-ink-800 py-1 shadow-2xl shadow-black/50">${items}</div>` : ""}
  </div>`;
}

function visible() {
  const q = norm(state.query).split(/\s+/).filter(Boolean);
  return sorted(state.notes).filter((n) => {
    if (state.course !== "ALL" && !n.corsi.includes(state.course)) return false;
    if (!q.length) return true;
    const hay = norm(n.titolo + " " + n.corsi.join(" "));
    return q.every((w) => hay.includes(w));
  });
}

/* Correzioni (fonte "voti") del corso selezionato: compaiono SOLO nelle pagine delle singole materie */
function correctionsFor(course) {
  if (course === "ALL") return [];
  const q = norm(state.query).split(/\s+/).filter(Boolean);
  return sorted(state.corrections).filter(
    (n) =>
      n.corsi.some((c) => norm(c) === norm(course)) &&
      q.every((w) => norm(n.titolo).includes(w)),
  );
}
const findNote = (id) =>
  state.notes.find((x) => x.id === id) ||
  state.corrections.find((x) => x.id === id);

/* Colore del corso -> variabile CSS --c (evidenziazione, barra di scorrimento, indice) */
function applyTheme(target, course) {
  target.style.setProperty(
    "--c",
    course && course !== "ALL" ? col(course, 66) : "#818cf8",
  );
}

/* Testo di un titolo per l'indice: tiene le formule già renderizzate (senza la parte MathML nascosta) e toglie eventuali link */
const headingHTML = (h) => {
  const c = h.cloneNode(true);
  c.querySelectorAll(".katex-mathml").forEach((n) => n.remove());
  c.querySelectorAll("a").forEach((a) => a.replaceWith(...a.childNodes));
  return c.innerHTML;
};

/* Indice laterale della nota, con evidenziazione della sezione corrente */
let tocObserver;
function buildToc() {
  tocObserver?.disconnect();
  const heads = [
    ...document.querySelectorAll("#sheetBody h1, #sheetBody h2, #sheetBody h3"),
  ];
  const toc = $("#toc"),
    sheet = $("#sheet"),
    show = heads.length >= 2;
  sheet.classList.toggle("max-w-5xl", show);
  sheet.classList.toggle("max-w-3xl", !show);
  toc.style.display = show ? "" : "none";
  if (!show) {
    toc.innerHTML = "";
    return;
  }
  const base = Math.min(...heads.map((h) => +h.tagName[1]));
  heads.forEach((h, i) => {
    h.id = "sec-" + i;
  });
  toc.innerHTML = `<nav class="toc scroll sticky top-6"><p class="toc-label">Indice</p>${heads
    .map(
      (h, i) =>
        `<a href="#sec-${i}" data-i="${i}" style="padding-left:${12 + (+h.tagName[1] - base) * 12}px">${headingHTML(h)}</a>`,
    )
    .join("")}</nav>`;
  const links = [...toc.querySelectorAll("a")];
  const setActive = (i) =>
    links.forEach((l, k) => l.classList.toggle("active", k === i));
  setActive(0);
  tocObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((en) => {
        if (en.isIntersecting) setActive(+en.target.id.slice(4));
      });
    },
    { root: $("#modalScroll"), rootMargin: "-10% 0px -80% 0px" },
  );
  heads.forEach((h) => tocObserver.observe(h));
}
$("#toc").addEventListener("click", (e) => {
  const a = e.target.closest("a[data-i]");
  if (!a) return;
  e.preventDefault();
  document
    .getElementById("sec-" + a.dataset.i)
    .scrollIntoView({ behavior: "smooth", block: "start" });
});

/* ---------- Render ---------- */
function renderNav() {
  const total = state.notes.length;
  const item = (key, label, count, dot) => {
    const active = state.course === key;
    return `<button data-course="${esc(key)}" class="group w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-left transition ${active ? "bg-white/[0.07] text-white" : "text-slate-400 hover:text-slate-100 hover:bg-white/[0.04]"}">
      ${dot}<span class="flex-1 truncate font-medium">${esc(label)}</span>
      <span class="text-xs tabular-nums rounded-md px-1.5 py-0.5 ${active ? "bg-white/10 text-white" : "text-slate-500 group-hover:text-slate-300"}">${count}</span></button>`;
  };
  const allDot = `<span class="h-5 w-5 grid place-items-center rounded-md bg-gradient-to-br from-indigo-400/30 to-violet-500/30 text-indigo-200"><svg class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M4 6h16M4 12h16M4 18h16"/></svg></span>`;
  let html =
    item("ALL", "Tutti gli appunti", total, allDot) + '<div class="h-2"></div>';
  if (state.loading)
    html += Array.from(
      { length: 4 },
      () => '<div class="skeleton h-10 rounded-xl mx-0 my-1"></div>',
    ).join("");
  else
    html += courseList()
      .map(([c, n]) =>
        item(
          c,
          c,
          n,
          `<span class="h-2.5 w-2.5 mx-[5px] rounded-full" style="background:${col(c, 62)};box-shadow:0 0 12px ${colA(c, 0.5)}"></span>`,
        ),
      )
      .join("");
  $("#nav").innerHTML = html;
}

function jumpHTML() {
  if (state.loading || state.course === "ALL") return "";
  const n = correctionsFor(state.course).length;
  if (!n) return "";
  const c = state.course;
  return `<button id="jumpCorr" type="button" class="mt-4 inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-semibold transition hover:brightness-125" style="color:${col(c, 74)};background:${colA(c, 0.12)};box-shadow:inset 0 0 0 1px ${colA(c, 0.25)}">Vai alle correzioni <span class="tabular-nums opacity-70">${n}</span><span aria-hidden="true">↓</span></button>`;
}

function courseInfoHTML() {
  if (state.course === "ALL") return "";
  const key = Object.keys(COURSE_INFO).find(
    (k) => norm(k) === norm(state.course),
  );
  const docenti = key ? COURSE_INFO[key].docenti : [];
  if (!docenti.length) return "";
  const c = state.course;
  const rows = docenti
    .map(
      (d) => `<div class="flex items-center gap-3">
      <span class="h-8 w-8 shrink-0 grid place-items-center rounded-full text-[11px] font-bold text-white" style="background:linear-gradient(135deg,${col(c, 55)},${col(c, 40)})">${esc(initials(d.nome))}</span>
      <div class="min-w-0">
        <div class="text-sm font-medium text-slate-100 truncate">${esc(d.nome)}</div>
        ${d.ruolo ? `<div class="text-[11px] uppercase tracking-wider" style="color:${col(c, 72)}">${esc(d.ruolo)}</div>` : ""}
      </div></div>`,
    )
    .join("");
  return `<div class="shrink-0 rounded-2xl border border-white/[0.07] px-4 py-3.5 space-y-3 sm:min-w-[220px]" style="background:${colA(c, 0.06)}">
    <div class="text-[10px] font-semibold uppercase tracking-widest text-slate-500">${docenti.length > 1 ? "Docenti" : "Docente"}</div>${rows}</div>`;
}

function renderHead(list) {
  const isAll = state.course === "ALL";
  const title = isAll ? "Tutti gli appunti" : state.course;
  const accent = isAll
    ? ""
    : `<span class="inline-block h-3 w-3 rounded-full mr-3 align-middle" style="background:${col(state.course, 62)};box-shadow:0 0 18px ${colA(state.course, 0.6)}"></span>`;
  const q = state.query
    ? ` per <span class="text-slate-200">“${esc(state.query)}”</span>`
    : "";
  const count = state.loading
    ? "Caricamento…"
    : `${list.length} ${list.length === 1 ? "appunto trovato" : "appunti trovati"}${q}`;
  $("#head").innerHTML =
    `<div class="animate-fadeUp flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
    <div class="min-w-0">
      <h2 class="text-3xl sm:text-4xl font-bold tracking-tight text-white">${accent}${esc(title)}</h2>
      <p class="mt-2 text-sm text-slate-400">${count}</p>
      <div class="mt-4 flex flex-wrap items-center gap-3">${sortHTML()}${jumpHTML().replace("mt-4 ", "")}</div>
    </div>
    ${courseInfoHTML()}
  </div>`;
}

function cardHTML(n, i) {
  const primary =
    state.course !== "ALL" && n.corsi.includes(state.course)
      ? state.course
      : n.corsi[0];
  return `<button data-id="${esc(n.id)}" style="animation-delay:${Math.min(i, 12) * 45}ms;--glow:${colA(primary, 0.16)}" class="card animate-fadeUp group text-left rounded-2xl border border-white/[0.07] p-5 flex flex-col min-h-[210px] focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/60">
    <div class="flex flex-wrap items-center gap-2">${n.corsi.map(badge).join("")}</div>
    <div class="mt-4 flex items-center gap-1.5 text-xs text-slate-500">
      <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M8 7V3m8 4V3M4 11h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z"/></svg>
      ${fmtDate(n.data)}
    </div>
    <h3 class="mt-2 text-[17px] leading-snug font-semibold tracking-tight text-slate-50 group-hover:text-white line-clamp-3">${highlight(n.titolo, state.query)}</h3>
    <div class="mt-auto pt-5 flex items-center justify-between gap-3">
      <div class="flex items-center gap-2 min-w-0">
        <span class="h-6 w-6 shrink-0 grid place-items-center rounded-full text-[10px] font-bold text-white" style="background:linear-gradient(135deg,${col(primary, 55)},${col(primary, 40)})">${esc(initials(n.autore))}</span>
        <span class="truncate text-xs text-slate-400">${esc(n.autore)}</span>
      </div>
      <span class="shrink-0 inline-flex items-center gap-1 text-xs font-semibold text-indigo-300 group-hover:text-indigo-200">Leggi <span class="transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5">↗</span></span>
    </div>
  </button>`;
}

function renderGrid(list) {
  const g = $("#grid");
  if (state.loading) {
    g.innerHTML = Array.from(
      { length: 6 },
      () =>
        '<div class="skeleton h-[210px] rounded-2xl border border-white/[0.05]"></div>',
    ).join("");
    return;
  }
  if (state.source === "error") {
    g.innerHTML = emptyState(
      "Impossibile caricare gli appunti",
      "Controlla la connessione al server e riprova.",
      true,
    );
    return;
  }
  if (!list.length) {
    g.innerHTML = emptyState(
      "Nessun appunto trovato",
      state.query
        ? "Prova con un altro termine di ricerca."
        : "Non ci sono ancora appunti pubblicati per questo corso.",
      false,
    );
    return;
  }
  g.innerHTML = list.map(cardHTML).join("");
}
const emptyState = (
  t,
  s,
  retry,
) => `<div class="col-span-full grid place-items-center py-24 text-center animate-fadeUp">
  <div class="h-14 w-14 rounded-2xl grid place-items-center bg-white/5 text-slate-400 mb-4"><svg class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.6"><path stroke-linecap="round" stroke-linejoin="round" d="m21 21-4.3-4.3M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0ZM8 10h4"/></svg></div>
  <p class="font-semibold text-slate-200">${t}</p><p class="mt-1 text-sm text-slate-500">${s}</p>
  ${retry ? '<button id="retry" class="mt-5 rounded-lg bg-indigo-500 hover:bg-indigo-400 px-4 py-2 text-sm font-semibold text-white">Riprova</button>' : ""}</div>`;

/* Sezione "Correzioni" sotto gli appunti della materia (creata una volta sola, subito dopo la griglia) */
const corrEl = document.createElement("section");
corrEl.id = "correzioni";
$("#grid").after(corrEl);

function renderCorrections() {
  const list = state.loading ? [] : correctionsFor(state.course);
  if (!list.length) {
    corrEl.innerHTML = "";
    corrEl.className = "";
    return;
  }
  const c = state.course;
  corrEl.className = "mt-14";
  corrEl.style.scrollMarginTop = "1.5rem";
  corrEl.innerHTML = `<div class="flex items-center gap-3 mb-5">
      <span class="h-2.5 w-2.5 rounded-full" style="background:${col(c, 62)};box-shadow:0 0 12px ${colA(c, 0.5)}"></span>
      <h2 class="text-xl font-bold tracking-tight text-white">Correzioni</h2>
      <span class="text-xs tabular-nums rounded-md bg-white/10 px-1.5 py-0.5 text-slate-300">${list.length}</span>
      <span class="h-px flex-1 bg-white/[0.08]"></span>
    </div>
    <div class="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">${list.map(cardHTML).join("")}</div>`;
}

function renderSync() {
  const map = {
    live: [
      "bg-emerald-400 shadow-[0_0_10px_#34d399]",
      "Sincronizzato con Notion",
    ],
    mock: ["bg-amber-400 shadow-[0_0_10px_#fbbf24]", "Dati di esempio"],
    fallback: ["bg-amber-400", "Offline · dati di esempio"],
    error: ["bg-rose-400", "Errore di sincronizzazione"],
  };
  const [cls, label] = state.loading
    ? ["bg-slate-600 animate-pulse", "Sincronizzazione…"]
    : map[state.source];
  $("#syncDot").className = "h-2 w-2 rounded-full " + cls;
  $("#syncLabel").textContent = label;
}

function render() {
  applyTheme(document.documentElement, state.course);
  const fk = state.course + "|" + Object.keys(state.courseIcons).length;
  if (!currentNote && fk !== favKey) {
    favKey = fk;
    resetFavicon();
    applyCourseFavicon();
  }
  const list = visible();
  renderNav();
  renderHead(list);
  renderGrid(list);
  renderCorrections();
  renderSync();
}

/* ---------- Rendering contenuto Notion ---------- */
/* ---------- Formule (KaTeX: lo stesso motore che usa Notion) ---------- */
function math(expr, display) {
  const src = String(expr ?? "").trim();
  if (!src) return "";
  if (!window.katex) return `<code class="inline">${esc(src)}</code>`; // KaTeX non caricato: mostra il testo LaTeX
  try {
    return katex.renderToString(src, {
      displayMode: !!display,
      throwOnError: false, // formula sbagliata: mostra il testo invece di rompere la nota
      strict: "ignore", // niente avvisi per lettere accentate dentro \text{...}
      trust: false,
      output: "htmlAndMathml", // MathML nascosto per screen reader e copia/incolla
    });
  } catch {
    return `<code class="inline">${esc(src)}</code>`;
  }
}

function rt(parts = []) {
  return parts
    .map((p) => {
      // Formula dentro al testo (in Notion: "Inline equation")
      if (p.type === "equation")
        return `<span class="eq-inline">${math(p.equation?.expression ?? p.plain_text, false)}</span>`;
      let s = esc(p.plain_text ?? p.text?.content ?? "");
      const a = p.annotations || {};
      if (a.code) s = `<code class="inline">${s}</code>`;
      if (a.bold)
        s = `<strong class="font-semibold text-slate-100">${s}</strong>`;
      if (a.italic) s = `<em>${s}</em>`;
      if (a.strikethrough) s = `<s>${s}</s>`;
      if (a.underline) s = `<u>${s}</u>`;
      if (a.href || p.href)
        s = `<a href="${esc(a.href || p.href)}" target="_blank" rel="noopener noreferrer">${s}</a>`;
      return s;
    })
    .join("");
}
function blocksHTML(blocks) {
  let out = "",
    i = 0;
  while (i < blocks.length) {
    const b = blocks[i];
    if (b.type === "bulleted_list_item" || b.type === "numbered_list_item") {
      const tag = b.type === "bulleted_list_item" ? "ul" : "ol";
      out += `<${tag}>`;
      while (i < blocks.length && blocks[i].type === b.type) {
        out += `<li>${rt(blocks[i].rich_text)}</li>`;
        i++;
      }
      out += `</${tag}>`;
      continue;
    }
    switch (b.type) {
      case "heading_1":
        out += `<h1>${rt(b.rich_text)}</h1>`;
        break;
      case "heading_2":
        out += `<h2>${rt(b.rich_text)}</h2>`;
        break;
      case "heading_3":
        out += `<h3>${rt(b.rich_text)}</h3>`;
        break;
      case "paragraph":
        out += b.rich_text?.length ? `<p>${rt(b.rich_text)}</p>` : "";
        break;
      case "quote":
        out += `<blockquote>${rt(b.rich_text)}</blockquote>`;
        break;
      case "callout":
        out += `<div class="callout"><span class="text-xl leading-none">${esc(b.icon || "💡")}</span><div>${rt(b.rich_text)}</div></div>`;
        break;
      case "code":
        out += `<pre><code>${rt(b.rich_text)}</code></pre>`;
        break;
      case "equation":
        out += `<div class="eq-block scroll">${math(b.expression, true)}</div>`;
        break;
      case "table": {
        const rows = b.rows || [];
        if (!rows.length) break;
        const cell = (c, ri, ci) => {
          const byRow = b.header_row && ri === 0,
            byCol = b.header_col && ci === 0;
          return byRow || byCol
            ? `<th scope="${byRow ? "col" : "row"}">${rt(c)}</th>`
            : `<td>${rt(c)}</td>`;
        };
        out += `<div class="tbl-wrap scroll"><table class="nt-table">${rows.map((r, ri) => `<tr>${r.map((c, ci) => cell(c, ri, ci)).join("")}</tr>`).join("")}</table></div>`;
        break;
      }
      case "divider":
        out += "<hr>";
        break;
      case "to_do":
        out += `<div class="todo ${b.checked ? "done" : ""}"><span class="box">${b.checked ? '<svg class="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3.5"><path stroke-linecap="round" stroke-linejoin="round" d="m5 13 4 4L19 7"/></svg>' : ""}</span><span class="t">${rt(b.rich_text)}</span></div>`;
        break;
      case "image": {
        const u = b.url || "";
        if (!/^(https?:\/\/|\/(?!\/)|data:image\/)/.test(u)) break; // solo URL sicuri
        const src = u.startsWith("/") ? API_BASE + u : u; // /api/... passa dal tuo server
        const cap = rt(b.caption || []);
        const alt = (b.caption || []).map((p) => p.plain_text).join("");
        out += `<figure><a href="${esc(src)}" target="_blank" rel="noopener noreferrer"><img src="${esc(src)}" alt="${esc(alt)}" loading="lazy"></a>${cap ? `<figcaption>${cap}</figcaption>` : ""}</figure>`;
        break;
      }
    }
    i++;
  }
  return out;
}

/* ---------- Favicon della nota (come Notion: l'icona della pagina; se manca resta quella della home) ---------- */
const homeIcons = [...document.querySelectorAll('link[rel~="icon"]')].map((l) =>
  l.cloneNode(),
);
let faviconToken = 0;
function setFavicon(href) {
  document.querySelectorAll('link[rel~="icon"]').forEach((l) => l.remove());
  const l = document.createElement("link");
  l.rel = "icon";
  l.href = href;
  document.head.appendChild(l);
}
function resetFavicon() {
  faviconToken++;
  document.querySelectorAll('link[rel~="icon"]').forEach((l) => l.remove());
  homeIcons.forEach((l) => document.head.appendChild(l.cloneNode()));
}
function emojiFavicon(emoji) {
  try {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const x = c.getContext("2d");
    x.font =
      '52px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
    x.textAlign = "center";
    x.textBaseline = "middle";
    x.fillText(emoji, 32, 36);
    return c.toDataURL("image/png");
  } catch {
    return null;
  }
}
/* Favicon della materia aperta (icona della pagina corso su Notion); senza icona resta quella della home */
function applyCourseFavicon() {
  if (currentNote || state.course === "ALL") return;
  const ic = state.courseIcons[norm(state.course)];
  if (ic) applyIcon(ic);
}
let favKey = null;
function applyNoteFavicon(note) {
  applyIcon(note.icon || state.courseIcons[norm(state.course)]); // nota senza icona: usa quella della materia, altrimenti la home
}
function applyIcon(ic) {
  const mine = ++faviconToken;
  if (!ic) return;
  if (ic.type === "emoji") {
    const url = emojiFavicon(ic.emoji);
    if (url) setFavicon(url);
    return;
  }
  if (ic.type === "url" && /^(https?:\/\/|\/(?!\/))/.test(ic.url || "")) {
    const src = ic.url.startsWith("/") ? API_BASE + ic.url : ic.url;
    const img = new Image();
    // Si cambia la favicon solo se l'immagine si carica davvero (e la nota è ancora aperta)
    img.onload = () => {
      if (mine === faviconToken) setFavicon(src);
    };
    img.src = src;
  }
}

/* ---------- Scarica in PDF ----------
   Usa la stampa del browser ("Salva come PDF"): il PDF è vettoriale (testo selezionabile, formule nitide)
   e il browser fa scegliere dove salvarlo. Il nome proposto è il titolo della pagina: "Autore - Titolo". */
let titleBeforePrint = null;
function pdfName(n) {
  const clean = (s) =>
    String(s)
      .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const autore = n.autore && n.autore !== "Anonimo" ? clean(n.autore) : "";
  const nome = autore ? `${autore} - ${clean(n.titolo)}` : clean(n.titolo);
  return nome.slice(0, 150) || "Appunto";
}
function preparePrint() {
  if (!currentNote || document.body.classList.contains("printing")) return;
  titleBeforePrint = document.title;
  document.title = pdfName(currentNote);
  document.body.classList.add("printing");
}
function cleanupPrint() {
  document.body.classList.remove("printing");
  if (titleBeforePrint !== null) {
    document.title = titleBeforePrint;
    titleBeforePrint = null;
  }
}
async function downloadNote() {
  if (!currentNote) return;
  // Le immagini "lazy" sotto la piega non sono ancora caricate: le forziamo, altrimenti nel PDF resterebbero vuote
  const imgs = [...document.querySelectorAll("#sheetBody img")];
  imgs.forEach((i) => {
    i.loading = "eager";
  });
  await Promise.race([
    Promise.all(
      imgs.map((i) =>
        i.complete
          ? 0
          : new Promise((r) => {
              i.onload = i.onerror = r;
            }),
      ),
    ),
    new Promise((r) => setTimeout(r, 8000)),
  ]);
  try {
    await document.fonts?.ready; // font delle formule
  } catch {}
  preparePrint();
  window.print();
}
window.addEventListener("beforeprint", preparePrint); // vale anche per Ctrl+P con una nota aperta
window.addEventListener("afterprint", cleanupPrint);
$("#sheetHead").addEventListener("click", (e) => {
  if (e.target.closest("#dl:not([disabled])")) downloadNote();
});

/* ---------- Modal ---------- */
let lastFocus = null;
let currentNote = null;
async function openNote(id) {
  const n = findNote(id);
  if (!n) return;
  lastFocus = document.activeElement;
  currentNote = n;
  resetFavicon();
  applyNoteFavicon(n);
  const primary = n.corsi[0];
  applyTheme($("#modal"), primary);
  tocObserver?.disconnect();
  $("#toc").style.display = "none";
  $("#sheet").style.setProperty("--accent", col(primary, 65));
  $("#sheetBar").style.background =
    `linear-gradient(90deg, ${col(primary, 60)}, ${colA(primary, 0.0)})`;
  $("#sheetHead").innerHTML = `
    <div class="flex flex-wrap items-center gap-2 pr-12">${n.corsi.map(badge).join("")}</div>
    <h2 class="mt-4 text-2xl sm:text-[34px] sm:leading-[1.15] font-bold tracking-tight text-white pr-10">${esc(n.titolo)}</h2>
    <div class="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-slate-400">
      <span class="inline-flex items-center gap-2"><span class="h-6 w-6 grid place-items-center rounded-full text-[10px] font-bold text-white" style="background:linear-gradient(135deg,${col(primary, 55)},${col(primary, 40)})">${esc(initials(n.autore))}</span>${esc(n.autore)}</span>
      <span class="inline-flex items-center gap-1.5"><svg class="h-4 w-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M8 7V3m8 4V3M4 11h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z"/></svg>${fmtDateLong(n.data)}</span>
      <button id="dl" type="button" disabled title="Salva la nota come PDF" class="ml-auto inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition hover:brightness-125 disabled:opacity-40 disabled:cursor-wait" style="color:${col(primary, 74)};background:${colA(primary, 0.12)};box-shadow:inset 0 0 0 1px ${colA(primary, 0.25)}"><svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v11m0 0 4-4m-4 4-4-4M5 19h14"/></svg>Scarica</button>
    </div>`;
  $("#sheetBody").innerHTML =
    '<div class="space-y-3"><div class="skeleton h-4 w-3/4 rounded"></div><div class="skeleton h-4 w-full rounded"></div><div class="skeleton h-4 w-5/6 rounded"></div></div>';
  $("#modal").classList.remove("hidden");
  document.body.style.overflow = "hidden";
  $("#modalScroll").scrollTop = 0;
  $("#close").focus({ preventScroll: true });
  const blocks = await loadBlocks(n);
  // currentNote === n: se nel frattempo hai chiuso o aperto un'altra nota, non sovrascrive quella nuova
  if (currentNote === n && !$("#modal").classList.contains("hidden")) {
    $("#sheetBody").innerHTML =
      blocksHTML(blocks) || "<p>Questa nota è vuota.</p>";
    buildToc();
    $("#dl")?.removeAttribute("disabled");
  }
}
function closeNote() {
  currentNote = null;
  resetFavicon();
  applyCourseFavicon();
  $("#modal").classList.add("hidden");
  document.body.style.overflow = "";
  lastFocus?.focus?.({ preventScroll: true });
}

/* ---------- Eventi ---------- */
const sidebar = $("#sidebar"),
  scrim = $("#scrim");
const toggleSidebar = (open) => {
  sidebar.classList.toggle("-translate-x-full", !open);
  scrim.classList.toggle("hidden", !open);
};
$("#burger").onclick = () => toggleSidebar(true);
scrim.onclick = () => toggleSidebar(false);

$("#nav").addEventListener("click", (e) => {
  const b = e.target.closest("[data-course]");
  if (!b) return;
  state.course = b.dataset.course;
  render();
  toggleSidebar(false);
  $("#scroller").scrollTo({ top: 0, behavior: "smooth" });
});
$("#grid").addEventListener("click", (e) => {
  if (e.target.closest("#retry")) {
    loadNotes();
    return;
  }
  const c = e.target.closest("[data-id]");
  if (c) openNote(c.dataset.id);
});
$("#grid").addEventListener("pointermove", (e) => {
  const c = e.target.closest(".card");
  if (!c) return;
  const r = c.getBoundingClientRect();
  c.style.setProperty("--mx", e.clientX - r.left + "px");
  c.style.setProperty("--my", e.clientY - r.top + "px");
});

corrEl.addEventListener("click", (e) => {
  const c = e.target.closest("[data-id]");
  if (c) openNote(c.dataset.id);
});
corrEl.addEventListener("pointermove", (e) => {
  const c = e.target.closest(".card");
  if (!c) return;
  const r = c.getBoundingClientRect();
  c.style.setProperty("--mx", e.clientX - r.left + "px");
  c.style.setProperty("--my", e.clientY - r.top + "px");
});
// l'intestazione sta sopra la griglia: il menu di ordinamento non deve finire sotto le card
$("#head").style.cssText += ";position:relative;z-index:20";
$("#head").addEventListener("click", (e) => {
  const opt = e.target.closest("[data-sort]");
  if (opt || e.target.closest("#sortBtn")) e.stopPropagation(); // il re-render stacca il bottone: non deve scattare la chiusura sul document
  if (opt) {
    state.sort = opt.dataset.sort;
    state.sortOpen = false;
    return render();
  }
  if (e.target.closest("#sortBtn")) {
    state.sortOpen = !state.sortOpen;
    return render();
  }
  if (e.target.closest("#jumpCorr"))
    corrEl.scrollIntoView({ behavior: "smooth", block: "start" });
});

const search = $("#search");
let t;
search.addEventListener("input", () => {
  $("#clear").classList.toggle("hidden", !search.value);
  $("#kbd").classList.toggle("hidden", !!search.value);
  clearTimeout(t);
  t = setTimeout(() => {
    state.query = search.value.trim();
    render();
  }, 90);
});
$("#clear").onclick = () => {
  search.value = "";
  search.dispatchEvent(new Event("input"));
  search.focus();
};

$("#close").onclick = closeNote;
$("#backdrop").onclick = closeNote;
$("#modalScroll").addEventListener("click", (e) => {
  if (!e.target.closest("#sheet")) closeNote();
});
document.addEventListener("click", (e) => {
  if (state.sortOpen && !e.target.closest("#head")) {
    state.sortOpen = false;
    render();
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && state.sortOpen) {
    state.sortOpen = false;
    render();
  }
  if (e.key === "Escape") {
    if (!$("#modal").classList.contains("hidden")) closeNote();
    else toggleSidebar(false);
  }
  if (
    e.key === "/" &&
    document.activeElement !== search &&
    $("#modal").classList.contains("hidden")
  ) {
    e.preventDefault();
    toggleSidebar(true);
    search.focus();
  }
});

loadNotes();