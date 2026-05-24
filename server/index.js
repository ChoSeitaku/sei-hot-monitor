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
  for (const sub of subscriptions) {
    try {
      await webPush.sendNotification(sub, JSON.stringify(payload));
    } catch (error) {
      if (error.statusCode === 410 || error.statusCode === 404) {
        const filtered = subscriptions.filter((item) => item.endpoint !== sub.endpoint);
        await saveSubscriptions(filtered);
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
  try {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&t=h_`;
    const res = await safeFetch(url);
    if (!res.ok) return [];
    const html = await res.text();
    const $ = cheerioLoad(html);
    const items = [];
    $('a.result__a').each((_, el) => {
      const title = $(el).text().trim();
      const link = $(el).attr('href');
      if (title && link) {
        items.push({ source: 'DuckDuckGo', title, url: link });
      }
    });
    console.log('[fetch] DDG 返回', items.length, '条');
    return items.slice(0, 10);
  } catch (e) {
    console.error('[fetch] DDG 错误:', e.message);
    return [];
  }
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
        items.push({ source: 'Bing News', title, url: link });
      }
    });
    console.log('[fetch] Bing News 返回', items.length, '条');
    return items.slice(0, 10);
  } catch (e) {
    console.error('[fetch] News 错误:', e.message);
    return [];
  }
}

async function fetchTwitter(query) {
  if (!TWITTERAPI_KEY) {
    return [];
  }
  const encoded = encodeURIComponent(query);
  const url = `https://api.twitterapi.io/twitter/tweet/advanced_search?queryType=Latest&query=${encoded}`;
  const res = await safeFetch(url, {
    headers: {
      'X-API-Key': TWITTERAPI_KEY,
      Accept: 'application/json'
    }
  });
  if (!res.ok) {
    return [];
  }
  const json = await res.json();
  return (json.tweets || []).slice(0, 15).map((tweet) => ({
    source: 'Twitter',
    title: tweet.text?.slice(0, 120) || 'Twitter update',
    url: tweet.url || `https://twitter.com/i/web/status/${tweet.id}`,
    meta: {
      author: tweet.author?.userName,
      createdAt: tweet.createdAt,
      likeCount: tweet.likeCount,
      retweetCount: tweet.retweetCount
    }
  }));
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

  const byQuery = new Map();
  for (const item of deduped) {
    const q = item.query || '__none__';
    if (!byQuery.has(q)) byQuery.set(q, []);
    byQuery.get(q).push(item);
  }
  const interleaved = [];
  let added = true;
  for (let i = 0; added; i++) {
    added = false;
    for (const list of byQuery.values()) {
      if (i < list.length) {
        interleaved.push(list[i]);
        added = true;
      }
    }
  }

  const newHotspots = [];
  for (const candidate of interleaved.slice(0, 60)) {
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
