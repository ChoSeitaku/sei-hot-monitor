import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { load as cheerioLoad } from 'cheerio';
import cron from 'node-cron';
import dotenv from 'dotenv';
import nodemailer from 'nodemailer';
import webPush from 'web-push';
import { createHash } from 'crypto';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../data');
const KEYWORDS_FILE = path.join(DATA_DIR, 'keywords.json');
const HOTSPOTS_FILE = path.join(DATA_DIR, 'hotspots.json');
const SUBSCRIPTIONS_FILE = path.join(DATA_DIR, 'subscriptions.json');

const app = express();
app.use(cors());
app.use(express.json());

const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY || '';
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '';
const TWITTERAPI_KEY = process.env.TWITTERAPI_KEY || '';
const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_PORT = process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : 587;
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const EMAIL_RECIPIENTS = process.env.EMAIL_RECIPIENTS ? process.env.EMAIL_RECIPIENTS.split(',').map((v) => v.trim()).filter(Boolean) : [];
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
const PORT = process.env.PORT || 4000;

const defaultKeywords = {
  keywords: ['AI 编程', '大模型', 'OpenAI', 'GPT'],
  scope: 'AI 编程',
  lastScan: null,
  notifications: []
};

const DEFAULT_HOTSPOTS = { hotspots: [] };

async function ensureDataFiles() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(KEYWORDS_FILE);
  } catch {
    await fs.writeFile(KEYWORDS_FILE, JSON.stringify(defaultKeywords, null, 2), 'utf8');
  }
  try {
    await fs.access(HOTSPOTS_FILE);
  } catch {
    await fs.writeFile(HOTSPOTS_FILE, JSON.stringify(DEFAULT_HOTSPOTS, null, 2), 'utf8');
  }
  try {
    await fs.access(SUBSCRIPTIONS_FILE);
  } catch {
    await fs.writeFile(SUBSCRIPTIONS_FILE, JSON.stringify({ subscriptions: [] }, null, 2), 'utf8');
  }
}

async function readJson(file) {
  const text = await fs.readFile(file, 'utf8');
  return JSON.parse(text || '{}');
}

async function writeJson(file, value) {
  await fs.writeFile(file, JSON.stringify(value, null, 2), 'utf8');
}

function createEmailTransporter() {
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS || EMAIL_RECIPIENTS.length === 0) {
    return null;
  }
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS
    }
  });
}

function configureWebPush() {
  let publicKey = VAPID_PUBLIC_KEY;
  let privateKey = VAPID_PRIVATE_KEY;

  if (!publicKey || !privateKey) {
    const keys = webPush.generateVAPIDKeys();
    publicKey = keys.publicKey;
    privateKey = keys.privateKey;
    console.log('[push] 未检测到 VAPID keys，自动生成一组临时 Key');
  }

  try {
    webPush.setVapidDetails('mailto:admin@example.com', publicKey, privateKey);
  } catch (error) {
    console.warn('[push] VAPID key 格式不对，自动生成新的:', error.message);
    const keys = webPush.generateVAPIDKeys();
    publicKey = keys.publicKey;
    privateKey = keys.privateKey;
    webPush.setVapidDetails('mailto:admin@example.com', publicKey, privateKey);
  }

  return { publicKey, privateKey };
}

let vapidKeys;

async function getSubscriptions() {
  const data = await readJson(SUBSCRIPTIONS_FILE);
  return data.subscriptions || [];
}

async function saveSubscriptions(subscriptions) {
  await writeJson(SUBSCRIPTIONS_FILE, { subscriptions });
}

async function addSubscription(subscription) {
  const subscriptions = await getSubscriptions();
  const exists = subscriptions.some((item) => item.endpoint === subscription.endpoint);
  if (!exists) {
    subscriptions.push(subscription);
    await saveSubscriptions(subscriptions);
  }
}

async function sendBrowserNotification(payload) {
  const subscriptions = await getSubscriptions();
  console.log('[push] 发送通知，订阅数:', subscriptions.length);
  for (const sub of subscriptions) {
    try {
      await webPush.sendNotification(sub, JSON.stringify(payload));
      console.log('[push] 推送成功:', sub.endpoint.slice(0, 80) + '...');
    } catch (error) {
      console.error('[push] 推送失败:', error.statusCode, error.message, 'endpoint:', sub.endpoint.slice(0, 80) + '...');
      if (error.statusCode === 410 || error.statusCode === 404 || error.statusCode === 401) {
        const remaining = subscriptions.filter((item) => item.endpoint !== sub.endpoint);
        await saveSubscriptions(remaining);
        console.log('[push] 已清理无效订阅 (statusCode=' + error.statusCode + ')，剩余:', remaining.length);
      }
    }
  }
}

async function sendEmailNotification(subject, text) {
  const transporter = createEmailTransporter();
  if (!transporter) {
    return false;
  }
  const mailOptions = {
    from: SMTP_USER,
    to: EMAIL_RECIPIENTS,
    subject,
    text
  };
  await transporter.sendMail(mailOptions);
  return true;
}

async function notifyNewHotspots(newHotspots) {
  if (!newHotspots || newHotspots.length === 0) {
    return;
  }

  const title = `发现 ${newHotspots.length} 条新的 AI 热点`;
  const body = newHotspots.map((item) => `• ${item.title} (${item.source})`).join('\n');
  const url = newHotspots[0]?.url || '/';

  try {
    await sendBrowserNotification({
      title,
      body,
      url
    });
  } catch (e) {
    console.error('[notify] 浏览器推送失败:', e.message);
  }

  if (EMAIL_RECIPIENTS.length > 0) {
    try {
      await sendEmailNotification(title, `${body}\n\n详情请登录热点瞭望台查看。`);
    } catch (e) {
      console.error('[notify] 邮件发送失败:', e.message);
    }
  }
}

function throttleWait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function safeFetch(url, options = {}) {
  const { timeoutMs = 15000, ...fetchOptions } = options;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': userAgent },
      ...fetchOptions
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchBingSearch(query) {
  try {
    const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}`;
    const res = await safeFetch(url);
    if (!res.ok) return [];
    const html = await res.text();
    const $ = cheerioLoad(html);
    const items = [];
    $('li.b_algo h2 a').each((_, el) => {
      const title = $(el).text().trim();
      const link = $(el).attr('href');
      if (title && link) {
        items.push({ source: 'Bing', title, url: link });
      }
    });
    console.log('[fetch] Bing 返回', items.length, '条');
    return items.slice(0, 10);
  } catch (e) {
    console.error('[fetch] Bing 错误:', e.message);
    return [];
  }
}

async function fetchDuckDuckGo(query) {
  const urls = [
    `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&t=h_`,
    `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`
  ];
  for (const url of urls) {
    try {
      const res = await safeFetch(url);
      if (!res.ok) continue;
      const html = await res.text();
      const $ = cheerioLoad(html);
      const items = [];
      $('a.result__a, a.result-link').each((_, el) => {
        const title = $(el).text().trim();
        const link = $(el).attr('href');
        if (title && link) {
          items.push({ source: 'DuckDuckGo', title, url: link });
        }
      });
      if (items.length > 0) {
        console.log('[fetch] DDG 返回', items.length, '条');
        return items.slice(0, 10);
      }
    } catch (e) {
      // try next fallback
    }
  }
  console.error('[fetch] DDG 所有 URL 均失败');
  return [];
}

async function fetchBingNews(query) {
  try {
    const url = `https://www.bing.com/news/search?q=${encodeURIComponent(query)}`;
    const res = await safeFetch(url);
    if (!res.ok) return [];
    const html = await res.text();
    const $ = cheerioLoad(html);
    const items = [];
    $('a.title').each((_, el) => {
      const title = $(el).text().trim();
      const link = $(el).attr('href');
      if (title && link) {
        const card = $(el).closest('.news-card, .newsitem, .nwsItm, .t_t');
        const timeText = card.find('.source span, .source, .news-card_caption-time, [aria-label*="ago"], [aria-label*="前"]').first().text().trim()
          || card.find('cite span').last().text().trim();
        const publishedAt = parseRelativeTime(timeText);
        items.push({ source: 'Bing News', title, url: link, publishedAt });
      }
    });
    console.log('[fetch] Bing News 返回', items.length, '条');
    return items.slice(0, 10);
  } catch (e) {
    console.error('[fetch] News 错误:', e.message);
    return [];
  }
}

function parseRelativeTime(text) {
  if (!text) return null;
  const now = Date.now();
  const lower = text.toLowerCase();
  let m;
  if ((m = lower.match(/(\d+)\s*(minute|min|分钟)/))) return new Date(now - parseInt(m[1], 10) * 60 * 1000).toISOString();
  if ((m = lower.match(/(\d+)\s*(hour|hr|小时)/))) return new Date(now - parseInt(m[1], 10) * 3600 * 1000).toISOString();
  if ((m = lower.match(/(\d+)\s*(day|天)/))) return new Date(now - parseInt(m[1], 10) * 86400 * 1000).toISOString();
  if ((m = lower.match(/(\d+)\s*(week|周)/))) return new Date(now - parseInt(m[1], 10) * 7 * 86400 * 1000).toISOString();
  if ((m = lower.match(/(\d+)\s*(month|月)/))) return new Date(now - parseInt(m[1], 10) * 30 * 86400 * 1000).toISOString();
  const d = new Date(text);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

async function fetchSogou(query) {
  try {
    const url = `https://www.sogou.com/web?query=${encodeURIComponent(query)}`;
    const res = await safeFetch(url, { timeoutMs: 12000 });
    if (!res.ok) return [];
    const html = await res.text();
    const $ = cheerioLoad(html);
    const items = [];
    $('.results .vrwrap, .rb').each((_, el) => {
      const a = $(el).find('h3 a, .vr-title a').first();
      const title = a.text().trim();
      const link = a.attr('href');
      if (title && link) {
        items.push({ source: 'Sogou', title, url: link });
      }
    });
    console.log('[fetch] Sogou 返回', items.length, '条');
    return items.slice(0, 10).map((item) => ({
      ...item,
      url: item.url.startsWith('/') ? `https://www.sogou.com${item.url}` : item.url
    }));
  } catch (e) {
    console.error('[fetch] Sogou 错误:', e.message);
    return [];
  }
}

async function fetchSogouWeChat(query) {
  try {
    const url = `https://weixin.sogou.com/weixin?type=2&query=${encodeURIComponent(query)}`;
    const res = await safeFetch(url, { timeoutMs: 12000 });
    if (!res.ok) return [];
    const html = await res.text();
    const $ = cheerioLoad(html);
    const items = [];
    $('.news-list li').each((_, el) => {
      const a = $(el).find('.txt-box h3 a, .tit a').first();
      const title = a.text().trim();
      const link = a.attr('href');
      if (title && link) {
        const fullUrl = link.startsWith('/') ? `https://weixin.sogou.com${link}` : link;
        items.push({ source: 'WeChat', title, url: fullUrl });
      }
    });
    console.log('[fetch] Sogou 微信 返回', items.length, '条');
    return items.slice(0, 8);
  } catch (e) {
    console.error('[fetch] Sogou 微信 错误:', e.message);
    return [];
  }
}

const BILI_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const BILI_WBI_MIXIN_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
  27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
  37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
  22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52
];
const biliState = { buvid3: '', imgKey: '', subKey: '', expiresAt: 0 };

async function refreshBilibiliCreds() {
  if (Date.now() < biliState.expiresAt && biliState.imgKey && biliState.buvid3) return;
  // 拿 buvid3 cookie
  const home = await safeFetch('https://www.bilibili.com/', {
    timeoutMs: 10000,
    headers: { 'User-Agent': BILI_UA }
  });
  const setCookies = home.headers.getSetCookie?.() || [];
  for (const c of setCookies) {
    const m = c.match(/buvid3=([^;]+)/);
    if (m) { biliState.buvid3 = m[1]; break; }
  }
  // 拿 wbi 密钥
  const nav = await safeFetch('https://api.bilibili.com/x/web-interface/nav', {
    timeoutMs: 10000,
    headers: {
      'User-Agent': BILI_UA,
      'Referer': 'https://www.bilibili.com/',
      'Cookie': biliState.buvid3 ? `buvid3=${biliState.buvid3}` : ''
    }
  });
  const navData = await nav.json();
  const imgUrl = navData?.data?.wbi_img?.img_url || '';
  const subUrl = navData?.data?.wbi_img?.sub_url || '';
  biliState.imgKey = imgUrl.split('/').pop().split('.')[0];
  biliState.subKey = subUrl.split('/').pop().split('.')[0];
  biliState.expiresAt = Date.now() + 30 * 60 * 1000; // 缓存 30 分钟
}

function signBilibili(params) {
  const orig = biliState.imgKey + biliState.subKey;
  const mixinKey = BILI_WBI_MIXIN_TAB.map((i) => orig[i]).join('').slice(0, 32);
  const wts = Math.floor(Date.now() / 1000);
  const merged = { ...params, wts };
  const sorted = Object.keys(merged).sort().map((k) => {
    const v = String(merged[k]).replace(/[!'()*]/g, '');
    return `${encodeURIComponent(k)}=${encodeURIComponent(v)}`;
  }).join('&');
  const wRid = createHash('md5').update(sorted + mixinKey).digest('hex');
  return `${sorted}&w_rid=${wRid}`;
}

async function fetchBilibili(query) {
  try {
    await refreshBilibiliCreds();
    if (!biliState.imgKey || !biliState.subKey) {
      console.warn('[fetch] Bilibili 缺少 WBI 密钥，跳过');
      return [];
    }
    const queryStr = signBilibili({
      search_type: 'video',
      keyword: query,
      order: 'totalrank',
      page: 1
    });
    const url = `https://api.bilibili.com/x/web-interface/wbi/search/type?${queryStr}`;
    const res = await safeFetch(url, {
      timeoutMs: 12000,
      headers: {
        'User-Agent': BILI_UA,
        'Referer': 'https://search.bilibili.com/',
        'Cookie': `buvid3=${biliState.buvid3}`
      }
    });
    if (!res.ok) return [];
    const data = await res.json();
    if (data.code !== 0) {
      console.warn('[fetch] Bilibili 返回非 0:', data.code, data.message);
      // 触发下次刷新凭据
      biliState.expiresAt = 0;
      return [];
    }
    const results = Array.isArray(data.data?.result) ? data.data.result : [];
    const items = results.slice(0, 10).map((r) => ({
      source: 'Bilibili',
      title: (r.title || '').replace(/<[^>]+>/g, ''),
      url: r.arcurl || `https://www.bilibili.com/video/${r.bvid}`,
      publishedAt: r.pubdate ? new Date(r.pubdate * 1000).toISOString() : null
    })).filter((item) => item.title && item.url);
    console.log('[fetch] Bilibili 返回', items.length, '条');
    return items;
  } catch (e) {
    console.error('[fetch] Bilibili 错误:', e.message);
    return [];
  }
}

async function fetchBaidu(query) {
  try {
    const url = `https://www.baidu.com/s?wd=${encodeURIComponent(query)}&rn=10`;
    const res = await safeFetch(url, { timeoutMs: 12000 });
    if (!res.ok) return [];
    const html = await res.text();
    const $ = cheerioLoad(html);
    const items = [];
    $('#content_left .result, #content_left .c-container').each((_, el) => {
      const a = $(el).find('h3 a').first();
      const title = a.text().trim();
      const link = a.attr('href');
      if (title && link) {
        items.push({ source: 'Baidu', title, url: link });
      }
    });
    console.log('[fetch] Baidu 返回', items.length, '条');
    return items.slice(0, 10);
  } catch (e) {
    console.error('[fetch] Baidu 错误:', e.message);
    return [];
  }
}


async function fetchHackerNews(query) {
  try {
    const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=story&hitsPerPage=10`;
    const res = await safeFetch(url, { timeoutMs: 12000 });
    if (!res.ok) return [];
    const json = await res.json();
    const items = [];
    (json.hits || []).forEach((hit) => {
      items.push({
        source: 'HackerNews',
        title: hit.title || '',
        url: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
        publishedAt: hit.created_at || null,
        meta: {
          points: hit.points,
          num_comments: hit.num_comments,
          author: hit.author,
          createdAt: hit.created_at
        }
      });
    });
    console.log('[fetch] HN 返回', items.length, '条');
    return items;
  } catch (e) {
    console.error('[fetch] HN 错误:', e.message);
    return [];
  }
}

async function fetchTwitter(query) {
  if (!TWITTERAPI_KEY) {
    return [];
  }
  // 使用 Top 排序按互动量返回热门推文（排行榜）；附加 min_faves 进一步保证质量
  const enhancedQuery = `${query} min_faves:5`;
  const encoded = encodeURIComponent(enhancedQuery);
  const url = `https://api.twitterapi.io/twitter/tweet/advanced_search?queryType=Top&query=${encoded}`;
  let res;
  try {
    res = await safeFetch(url, {
      headers: {
        'X-API-Key': TWITTERAPI_KEY,
        Accept: 'application/json'
      }
    });
  } catch (e) {
    console.error('[fetch] Twitter 网络错误:', e.message);
    return [];
  }
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    console.error(`[fetch] Twitter HTTP ${res.status}: ${errText.slice(0, 200)}`);
    return [];
  }
  const json = await res.json();
  const tweetsArr = json.tweets || json.data || [];
  const rawTweets = tweetsArr.slice(0, 30).map((tweet) => {
    let publishedAt = null;
    if (tweet.createdAt) {
      const d = new Date(tweet.createdAt);
      if (!Number.isNaN(d.getTime())) publishedAt = d.toISOString();
    }
    return {
      source: 'Twitter',
      title: tweet.text?.slice(0, 140) || 'Twitter update',
      url: tweet.url || `https://twitter.com/i/web/status/${tweet.id}`,
      publishedAt,
      meta: {
        author: tweet.author?.userName,
        createdAt: tweet.createdAt,
        likeCount: tweet.likeCount || 0,
        retweetCount: tweet.retweetCount || 0,
        viewCount: tweet.viewCount || 0
      }
    };
  });

  // Top 模式已按互动量排序，仅做轻量过滤：排除回复型短推（@开头）和极短文本
  const filtered = rawTweets.filter((t) => {
    if (t.title.startsWith('@')) return false;
    if (t.title.length < 15) return false;
    return true;
  });

  console.log(`[fetch] Twitter "${query}" → 原始 ${rawTweets.length} 条 → 过滤后 ${filtered.length} 条`);
  return filtered.slice(0, 10);
}

async function callDeepSeek(prompt) {
  if (!DEEPSEEK_API_KEY) {
    return null;
  }
  const res = await safeFetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    timeoutMs: 60000,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${DEEPSEEK_API_KEY}`
    },
    body: JSON.stringify({
      model: 'deepseek-v4-flash',
      messages: [
        { role: 'system', content: '你是一个热点识别助手。只输出合法 JSON，不要任何额外文字。' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.2,
      max_tokens: 400,
      stream: false
    })
  });
  if (!res.ok) {
    return null;
  }
  const payload = await res.json();
  const content = payload?.choices?.[0]?.message?.content;
  if (!content) {
    return null;
  }
  try {
    return JSON.parse(content);
  } catch {
    return { text: content };
  }
}

async function callOpenRouter(prompt) {
  if (!OPENROUTER_KEY) {
    return null;
  }
  const res = await safeFetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENROUTER_KEY}`
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
      max_tokens: 300
    })
  });
  if (!res.ok) {
    return null;
  }
  const payload = await res.json();
  const content = payload?.choices?.[0]?.message?.content;
  if (!content) {
    return null;
  }
  try {
    return JSON.parse(content);
  } catch {
    return { text: content };
  }
}

function normalizeUrl(url) {
  return (url || '').replace(/\?.*$/, '').replace(/#.*$/, '');
}

// 把候选按「来源 × 查询关键词」双层公平轮询展平，并对单一来源设置硬配额，
// 防止某个高产源（如 Bing）淹没小众源（如 HackerNews / Twitter）。
function balanceCandidates(deduped, maxTotal = 60, minPerSource = 4) {
  if (deduped.length === 0) return [];

  // 第一层：按 source 分组，组内再按 query 分组并轮询展平为一个 source 队列
  const perSourceQueues = [];
  const bySource = new Map();
  for (const item of deduped) {
    const s = item.source || '__none__';
    if (!bySource.has(s)) bySource.set(s, []);
    bySource.get(s).push(item);
  }
  for (const [source, list] of bySource) {
    const byQuery = new Map();
    for (const item of list) {
      const q = item.query || '__none__';
      if (!byQuery.has(q)) byQuery.set(q, []);
      byQuery.get(q).push(item);
    }
    const queryLists = [...byQuery.values()];
    const queue = [];
    let any = true;
    for (let i = 0; any; i++) {
      any = false;
      for (const ql of queryLists) {
        if (i < ql.length) {
          queue.push(ql[i]);
          any = true;
        }
      }
    }
    perSourceQueues.push({ source, queue });
  }

  // 每源配额：均分总额度，但不低于 minPerSource，也不超过该源实际可用数
  const sourceCount = perSourceQueues.length;
  const quota = Math.max(Math.ceil(maxTotal / sourceCount), minPerSource);
  for (const entry of perSourceQueues) {
    entry.queue = entry.queue.slice(0, quota);
  }

  // 第二层：跨 source 公平轮询
  const interleaved = [];
  let any = true;
  for (let round = 0; any && interleaved.length < maxTotal; round++) {
    any = false;
    for (const entry of perSourceQueues) {
      if (round < entry.queue.length) {
        interleaved.push(entry.queue[round]);
        any = true;
        if (interleaved.length >= maxTotal) break;
      }
    }
  }

  const distribution = interleaved.reduce((acc, item) => {
    acc[item.source] = (acc[item.source] || 0) + 1;
    return acc;
  }, {});
  console.log('[scan] 送审源分布:', distribution, `(共 ${interleaved.length} 条; 每源配额 ${quota})`);
  return interleaved;
}

async function classifyCandidate(candidate, scope) {
  const topic = (scope || '').trim() || 'AI / 人工智能';
  const query = candidate.query || topic;
  const prompt = [
    `你是一个热点鉴别助手。用户的监控主题是「${topic}」，当前正在评估为关键词「${query}」搜索到的一条候选。`,
    `请判断该候选是否是与「${query}」相关的真实热点（新产品发布、新版本上线、技术突破、行业事件、研究进展、社区热门讨论都算热点；纯导航页/聚合目录/低质营销页/明显虚假内容不算）。`,
    '请输出合法 JSON，不包含多余文本。格式：{"isHot": true|false, "summary": "...", "confidence": 0.0, "reason": "..."}',
    '',
    `标题：${candidate.title}`,
    `来源：${candidate.source}`,
    `链接：${candidate.url}`,
    `附加信息：${candidate.meta ? JSON.stringify(candidate.meta) : '无'}`
  ].join('\n');

  let result = null;
  try {
    result = await callDeepSeek(prompt);
  } catch (e) {
    console.error('[ai] DeepSeek 调用错误:', e.message);
  }
  if (!result) {
    try {
      result = await callOpenRouter(prompt);
    } catch (e) {
      console.error('[ai] OpenRouter 调用错误:', e.message);
    }
  }
  if (!result) {
    return {
      isHot: false,
      summary: 'AI 识别不可用，已跳过',
      confidence: 0,
      reason: '未配置 DeepSeek 或 OpenRouter 或调用失败'
    };
  }

  return {
    isHot: Boolean(result.isHot),
    summary: result.summary || result.text || '未生成摘要',
    confidence: Number(result.confidence) || 0,
    reason: result.reason || 'AI 判定完成'
  };
}

async function scanHotspots(trigger = 'automatic') {
  console.log('[scan] 开始扫描，trigger=', trigger);
  const config = await readJson(KEYWORDS_FILE);
  const hotspotsData = await readJson(HOTSPOTS_FILE);
  const queryItems = [...new Set([...(config.keywords || []), config.scope || ''])].filter(Boolean);
  console.log('[scan] 查询关键词:', queryItems);

  const candidatePromises = [];
  for (const query of queryItems) {
    candidatePromises.push(fetchBingSearch(query).then((v) => v.map((item) => ({ query, ...item }))).catch(e => { console.error('[fetch] Bing 错误:', e.message); return []; }));
    candidatePromises.push(fetchDuckDuckGo(query).then((v) => v.map((item) => ({ query, ...item }))).catch(e => { console.error('[fetch] DDG 错误:', e.message); return []; }));
    candidatePromises.push(fetchBingNews(query).then((v) => v.map((item) => ({ query, ...item }))).catch(e => { console.error('[fetch] News 错误:', e.message); return []; }));
    candidatePromises.push(fetchSogou(query).then((v) => v.map((item) => ({ query, ...item }))).catch(e => { console.error('[fetch] Sogou 错误:', e.message); return []; }));
    candidatePromises.push(fetchSogouWeChat(query).then((v) => v.map((item) => ({ query, ...item }))).catch(e => { console.error('[fetch] WeChat 错误:', e.message); return []; }));
    candidatePromises.push(fetchBilibili(query).then((v) => v.map((item) => ({ query, ...item }))).catch(e => { console.error('[fetch] Bilibili 错误:', e.message); return []; }));
    candidatePromises.push(fetchHackerNews(query).then((v) => v.map((item) => ({ query, ...item }))).catch(e => { console.error('[fetch] HN 错误:', e.message); return []; }));
    await throttleWait(800);
    candidatePromises.push(fetchTwitter(query).then((v) => v.map((item) => ({ query, ...item }))).catch(e => { console.error('[fetch] Twitter 错误:', e.message); return []; }));
    await throttleWait(800);
  }

  const searches = await Promise.allSettled(candidatePromises);
  const candidates = searches.flatMap((result) => (result.status === 'fulfilled' ? result.value : []));

  const deduped = [];
  const seen = new Set();
  candidates.forEach((item) => {
    const key = `${item.source}::${normalizeUrl(item.url)}::${item.title}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(item);
    }
  });

  const rawDistribution = deduped.reduce((acc, item) => {
    acc[item.source] = (acc[item.source] || 0) + 1;
    return acc;
  }, {});
  console.log('[scan] 去重后源分布:', rawDistribution, '(共', deduped.length, '条)');

  const pubCoverage = deduped.reduce((acc, item) => {
    const s = item.source || 'Unknown';
    if (!acc[s]) acc[s] = { withPub: 0, total: 0 };
    acc[s].total += 1;
    if (item.publishedAt) acc[s].withPub += 1;
    return acc;
  }, {});
  const pubReport = Object.fromEntries(Object.entries(pubCoverage).map(([k, v]) => [k, `${v.withPub}/${v.total}`]));
  console.log('[scan] 发布时间覆盖率:', pubReport);

  const interleaved = balanceCandidates(deduped, 60);

  const newHotspots = [];
  for (const candidate of interleaved) {
    const classification = await classifyCandidate(candidate, config.scope);
    if (classification.isHot && classification.confidence >= 0.4) {
      const existing = hotspotsData.hotspots.find((entry) => entry.url && normalizeUrl(entry.url) === normalizeUrl(candidate.url));
      if (!existing) {
        newHotspots.push({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          query: candidate.query,
          source: candidate.source,
          title: candidate.title,
          url: candidate.url,
          summary: classification.summary,
          reason: classification.reason,
          confidence: classification.confidence,
          createdAt: new Date().toISOString(),
          publishedAt: candidate.publishedAt || null,
          trigger
        });
      }
    }
  }

  if (newHotspots.length) {
    hotspotsData.hotspots.unshift(...newHotspots);
    hotspotsData.hotspots = hotspotsData.hotspots.slice(0, 120);
    config.notifications = [
      ...(config.notifications || []),
      ...newHotspots.map((item) => ({
        id: item.id,
        title: item.title,
        source: item.source,
        url: item.url,
        createdAt: item.createdAt,
        summary: item.summary
      }))
    ].slice(-50);
    await writeJson(HOTSPOTS_FILE, hotspotsData);
    await writeJson(KEYWORDS_FILE, config);
    await notifyNewHotspots(newHotspots);
  }

  config.lastScan = new Date().toISOString();
  await writeJson(KEYWORDS_FILE, config);
  console.log('[scan] 扫描完成，新热点:', newHotspots.length, '条，候选数:', deduped.length);
  return { totalCandidates: deduped.length, newHotspots: newHotspots.length };
}

app.get('/api/config', async (req, res) => {
  const config = await readJson(KEYWORDS_FILE);
  res.json(config);
});

app.get('/api/hotspots', async (req, res) => {
  const hotspotsData = await readJson(HOTSPOTS_FILE);
  res.json(hotspotsData);
});

app.get('/api/notifications', async (req, res) => {
  const config = await readJson(KEYWORDS_FILE);
  res.json({ notifications: config.notifications || [] });
});

app.post('/api/keywords', async (req, res) => {
  const { keyword } = req.body;
  if (!keyword || typeof keyword !== 'string') {
    return res.status(400).json({ error: 'keyword 必须是字符串' });
  }
  const config = await readJson(KEYWORDS_FILE);
  config.keywords = Array.from(new Set([...(config.keywords || []), keyword.trim()])).filter(Boolean);
  await writeJson(KEYWORDS_FILE, config);
  res.json(config);
});

app.delete('/api/keywords/:keyword', async (req, res) => {
  const target = decodeURIComponent(req.params.keyword);
  const config = await readJson(KEYWORDS_FILE);
  config.keywords = (config.keywords || []).filter((item) => item !== target);
  await writeJson(KEYWORDS_FILE, config);
  res.json(config);
});

app.post('/api/scope', async (req, res) => {
  const { scope } = req.body;
  const config = await readJson(KEYWORDS_FILE);
  config.scope = typeof scope === 'string' ? scope.trim() : config.scope;
  await writeJson(KEYWORDS_FILE, config);
  res.json(config);
});

app.post('/api/scan', async (req, res) => {
  console.log('[api] 收到扫描请求');
  try {
    const result = await scanHotspots('manual');
    console.log('[api] 扫描完成:', result);
    res.json(result);
  } catch (error) {
    console.error('[api] 扫描失败:', error);
    res.status(500).json({ error: error.message || '扫描失败' });
  }
});

app.get('/api/push-public-key', (req, res) => {
  res.json({ publicKey: vapidKeys.publicKey });
});

app.post('/api/subscribe', async (req, res) => {
  const subscription = req.body;
  if (!subscription || !subscription.endpoint) {
    return res.status(400).json({ error: '非法推送订阅数据' });
  }
  try {
    await addSubscription(subscription);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message || '订阅保存失败' });
  }
});

app.post('/api/test-notify', async (req, res) => {
  const { type } = req.body;
  const results = {};

  if (!type || type === 'email') {
    if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS || EMAIL_RECIPIENTS.length === 0) {
      results.email = { success: false, error: 'SMTP 未完整配置' };
    } else {
      try {
        const sent = await sendEmailNotification(
          '[测试] 热点瞭望台邮件通知',
          '这是来自热点瞭望台的测试邮件。\n\n如果你收到此邮件，说明邮件通知功能配置正常。'
        );
        results.email = { success: true, recipients: EMAIL_RECIPIENTS };
      } catch (e) {
        results.email = { success: false, error: e.message };
      }
    }
  }

  if (!type || type === 'push') {
    try {
      await sendBrowserNotification({
        title: '[测试] 热点瞭望台推送通知',
        body: '浏览器推送通知功能配置正常！',
        url: '/'
      });
      results.push = { success: true, subscriptionCount: (await getSubscriptions()).length };
    } catch (e) {
      results.push = { success: false, error: e.message };
    }
  }

  res.json(results);
});

app.get('/api/health', async (req, res) => {
  const config = await readJson(KEYWORDS_FILE);
  res.json({
    status: 'ok',
    lastScan: config.lastScan || null,
    twitterConfigured: Boolean(TWITTERAPI_KEY),
    deepseekConfigured: Boolean(DEEPSEEK_API_KEY),
    openRouterConfigured: Boolean(OPENROUTER_KEY),
    emailConfigured: EMAIL_RECIPIENTS.length > 0,
    pushConfigured: Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY)
  });
});

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../dist')));
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../dist/index.html'));
  });
}

await ensureDataFiles();
vapidKeys = configureWebPush();
cron.schedule('*/30 * * * *', async () => {
  console.log('[cron] 开始自动热点扫描');
  try {
    await scanHotspots('automatic');
    console.log('[cron] 扫描完成');
  } catch (error) {
    console.error('[cron] 扫描失败', error.message);
  }
});

app.listen(PORT, () => {
  console.log(`Hotspot monitor server started at http://localhost:${PORT}`);
});
