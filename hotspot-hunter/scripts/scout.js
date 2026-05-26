import { load as cheerioLoad } from "cheerio";
import { createHash } from "node:crypto";

// ─── helpers ──────────────────────────────────────────────
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

async function safeFetch(url, opts = {}) {
  const { timeoutMs = 15000, ...rest } = opts;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: ctl.signal,
      headers: { "User-Agent": UA, ...(rest.headers || {}) },
      ...rest,
    });
  } finally {
    clearTimeout(t);
  }
}

function parseRelativeTime(text) {
  if (!text) return null;
  const now = Date.now();
  const lower = text.toLowerCase();
  let m;
  if ((m = lower.match(/(\d+)\s*(minute|min|分钟)/)))
    return new Date(now - Number(m[1]) * 6e4).toISOString();
  if ((m = lower.match(/(\d+)\s*(hour|hr|小时)/)))
    return new Date(now - Number(m[1]) * 36e5).toISOString();
  if ((m = lower.match(/(\d+)\s*(day|天)/)))
    return new Date(now - Number(m[1]) * 864e5).toISOString();
  if ((m = lower.match(/(\d+)\s*(week|周)/)))
    return new Date(now - Number(m[1]) * 7 * 864e5).toISOString();
  if ((m = lower.match(/(\d+)\s*(month|月)/)))
    return new Date(now - Number(m[1]) * 30 * 864e5).toISOString();
  const d = new Date(text);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// ─── Bilibili WBI sign ─────────────────────────────────────
const MIXIN_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5,
  49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55,
  40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57,
  62, 11, 36, 20, 34, 44, 52,
];

const bili = { buvid3: "", imgKey: "", subKey: "", expiresAt: 0 };

async function refreshBiliCreds() {
  if (Date.now() < bili.expiresAt && bili.imgKey && bili.buvid3) return;
  const home = await safeFetch("https://www.bilibili.com/", { timeoutMs: 10000 });
  for (const c of home.headers.getSetCookie?.() || []) {
    const m = c.match(/buvid3=([^;]+)/);
    if (m) {
      bili.buvid3 = m[1];
      break;
    }
  }
  const nav = await safeFetch("https://api.bilibili.com/x/web-interface/nav", {
    timeoutMs: 10000,
    headers: {
      "User-Agent": UA,
      Referer: "https://www.bilibili.com/",
      Cookie: bili.buvid3 ? `buvid3=${bili.buvid3}` : "",
    },
  });
  const nd = await nav.json();
  const img = nd?.data?.wbi_img?.img_url || "";
  const sub = nd?.data?.wbi_img?.sub_url || "";
  bili.imgKey = img.split("/").pop().split(".")[0];
  bili.subKey = sub.split("/").pop().split(".")[0];
  bili.expiresAt = Date.now() + 30 * 60 * 1000;
}

function signBili(params) {
  const orig = bili.imgKey + bili.subKey;
  const mixin = MIXIN_TAB.map((i) => orig[i]).join("").slice(0, 32);
  const wts = Math.floor(Date.now() / 1000);
  const merged = { ...params, wts };
  const sorted = Object.keys(merged)
    .sort()
    .map((k) => {
      const v = String(merged[k]).replace(/[!'()*]/g, "");
      return `${encodeURIComponent(k)}=${encodeURIComponent(v)}`;
    })
    .join("&");
  return `${sorted}&w_rid=${createHash("md5").update(sorted + mixin).digest("hex")}`;
}

// ─── scrapers ─────────────────────────────────────────────

async function fetchBing(query, max) {
  try {
    const res = await safeFetch(`https://www.bing.com/search?q=${encodeURIComponent(query)}`);
    if (!res.ok) return [];
    const $ = cheerioLoad(await res.text());
    const items = [];
    $("li.b_algo h2 a").each((_, el) => {
      const title = $(el).text().trim();
      const url = $(el).attr("href");
      if (title && url) items.push({ title, url });
    });
    return items.slice(0, max);
  } catch {
    return [];
  }
}

async function fetchBingNews(query, max) {
  try {
    const res = await safeFetch(`https://www.bing.com/news/search?q=${encodeURIComponent(query)}`);
    if (!res.ok) return [];
    const $ = cheerioLoad(await res.text());
    const items = [];
    $("a.title").each((_, el) => {
      const title = $(el).text().trim();
      const url = $(el).attr("href");
      if (!title || !url) return;
      const card = $(el).closest(".news-card, .newsitem, .nwsItm, .t_t");
      const timeText = card
        .find(".source span, .source, .news-card_caption-time, [aria-label*='ago'], [aria-label*='前']")
        .first()
        .text()
        .trim()
        || card.find("cite span").last().text().trim();
      items.push({ title, url, publishedAt: parseRelativeTime(timeText) });
    });
    return items.slice(0, max);
  } catch {
    return [];
  }
}

async function fetchDDG(query, max) {
  const urls = [
    `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&t=h_`,
    `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`,
  ];
  for (const url of urls) {
    try {
      const res = await safeFetch(url);
      if (!res.ok) continue;
      const $ = cheerioLoad(await res.text());
      const items = [];
      $("a.result__a, a.result-link").each((_, el) => {
        const title = $(el).text().trim();
        const url = $(el).attr("href");
        if (title && url) items.push({ title, url });
      });
      if (items.length) return items.slice(0, max);
    } catch { /* next fallback */ }
  }
  return [];
}

async function fetchSogou(query, max) {
  try {
    const res = await safeFetch(`https://www.sogou.com/web?query=${encodeURIComponent(query)}`, { timeoutMs: 12000 });
    if (!res.ok) return [];
    const $ = cheerioLoad(await res.text());
    const items = [];
    $(".results .vrwrap, .rb").each((_, el) => {
      const a = $(el).find("h3 a, .vr-title a").first();
      const title = a.text().trim();
      const url = a.attr("href");
      if (title && url) {
        items.push({
          title,
          url: url.startsWith("/") ? `https://www.sogou.com${url}` : url,
        });
      }
    });
    return items.slice(0, max);
  } catch {
    return [];
  }
}

async function fetchWeChat(query, max) {
  try {
    const res = await safeFetch(`https://weixin.sogou.com/weixin?type=2&query=${encodeURIComponent(query)}`, { timeoutMs: 12000 });
    if (!res.ok) return [];
    const $ = cheerioLoad(await res.text());
    const items = [];
    $(".news-list li").each((_, el) => {
      const a = $(el).find(".txt-box h3 a, .tit a").first();
      const title = a.text().trim();
      const url = a.attr("href");
      if (title && url) {
        items.push({ title, url: url.startsWith("/") ? `https://weixin.sogou.com${url}` : url });
      }
    });
    return items.slice(0, max);
  } catch {
    return [];
  }
}

async function fetchBilibili(query, max) {
  try {
    await refreshBiliCreds();
    if (!bili.imgKey || !bili.subKey) return [];
    const qs = signBili({ search_type: "video", keyword: query, order: "totalrank", page: 1 });
    const res = await safeFetch(`https://api.bilibili.com/x/web-interface/wbi/search/type?${qs}`, {
      timeoutMs: 12000,
      headers: {
        "User-Agent": UA,
        Referer: "https://search.bilibili.com/",
        Cookie: `buvid3=${bili.buvid3}`,
      },
    });
    if (!res.ok) return [];
    const data = await res.json();
    if (data.code !== 0) {
      bili.expiresAt = 0; // force refresh next time
      return [];
    }
    const results = Array.isArray(data.data?.result) ? data.data.result : [];
    return results
      .slice(0, max)
      .map((r) => ({
        title: (r.title || "").replace(/<[^>]+>/g, ""),
        url: r.arcurl || `https://www.bilibili.com/video/${r.bvid}`,
        publishedAt: r.pubdate ? new Date(r.pubdate * 1000).toISOString() : null,
      }))
      .filter((it) => it.title && it.url);
  } catch {
    return [];
  }
}

async function fetchHackerNews(query, max) {
  try {
    const res = await safeFetch(
      `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=story&hitsPerPage=${max}`,
      { timeoutMs: 12000 }
    );
    if (!res.ok) return [];
    const json = await res.json();
    return (json.hits || []).map((h) => ({
      title: h.title || "",
      url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
      publishedAt: h.created_at || null,
      meta: { points: h.points, comments: h.num_comments, author: h.author },
    }));
  } catch {
    return [];
  }
}

// ─── main ──────────────────────────────────────────────────

const SOURCES = {
  bing: fetchBing,
  "bing-news": fetchBingNews,
  ddg: fetchDDG,
  sogou: fetchSogou,
  wechat: fetchWeChat,
  bilibili: fetchBilibili,
  hackernews: fetchHackerNews,
};

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { query: "", sources: Object.keys(SOURCES), max: 10 };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--query" || args[i] === "-q") opts.query = args[++i] || "";
    else if (args[i] === "--sources" || args[i] === "-s")
      opts.sources = (args[++i] || "").split(",").map((s) => s.trim()).filter(Boolean);
    else if (args[i] === "--max" || args[i] === "-m") opts.max = Number(args[++i]) || 10;
    else if (args[i] === "--help" || args[i] === "-h") {
      console.log(`Usage: node scout.js --query <keywords> [--sources src1,src2] [--max N]

Options:
  -q, --query     Search query (required)
  -s, --sources   Comma-separated source list. Available: ${Object.keys(SOURCES).join(", ")}
                   Default: all
  -m, --max       Max results per source (default 10)
  -h, --help      Show this help`);
      process.exit(0);
    }
  }
  if (!opts.query) {
    console.error("Error: --query is required. Use --help for usage.");
    process.exit(1);
  }
  // validate sources
  const bad = opts.sources.filter((s) => !SOURCES[s]);
  if (bad.length) {
    console.error(`Error: unknown source(s): ${bad.join(", ")}. Available: ${Object.keys(SOURCES).join(", ")}`);
    process.exit(1);
  }
  return opts;
}

const opts = parseArgs();

const results = await Promise.allSettled(
  opts.sources.map(async (src) => {
    const items = await SOURCES[src](opts.query, opts.max);
    return items.map((item) => ({ source: src, query: opts.query, ...item }));
  })
);

const candidates = results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));

// deduplicate by source + url + title
const seen = new Set();
const deduped = candidates.filter((item) => {
  const key = `${item.source}::${item.url}::${item.title}`;
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
});

// sort by publishedAt desc (items with dates first, then rest)
deduped.sort((a, b) => {
  const pa = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
  const pb = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
  return pb - pa;
});

const sourcesUsed = [...new Set(deduped.map((c) => c.source))];
const perSource = sourcesUsed.reduce((acc, s) => {
  acc[s] = deduped.filter((c) => c.source === s).length;
  return acc;
}, {});

process.stdout.write(
  JSON.stringify(
    {
      query: opts.query,
      sources: sourcesUsed,
      perSource,
      total: deduped.length,
      candidates: deduped,
    },
    null,
    2
  )
);
