import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search, Zap, Settings2, Radio, Bell, Plus, X, ExternalLink,
  TrendingUp, Activity, Clock, Globe, Layers, ArrowDownWideNarrow, Flame, CalendarClock,
  ChevronLeft, ChevronRight, ChevronDown, ChevronsDownUp, ChevronsUpDown,
  Sparkle, Link2, Copy, Check, WandSparkles
} from 'lucide-react';
import { WavyBackground } from './components/ui/wavy-background';
import { Sparkles } from './components/ui/sparkles';
import { AnimatedCounter } from './components/ui/animated-counter';
import { FloatingParticles } from './components/ui/floating-particles';
import { BentoGrid, BentoGridItem } from './components/ui/bento-grid';

const API = {
  config: '/api/config',
  hotspots: '/api/hotspots',
  notifications: '/api/notifications',
  scan: '/api/scan',
  keywords: '/api/keywords',
  scope: '/api/scope',
  health: '/api/health',
  pushKey: '/api/push-public-key',
  subscribe: '/api/subscribe'
};

const SOURCES = ['Bing', 'Bing News', 'Sogou', 'WeChat', 'Bilibili', 'HackerNews', 'Twitter'];
const PAGE_SIZE = 10;

function buildPageRange(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const wanted = new Set([1, total, current, current - 1, current + 1]);
  const pages = [...wanted].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b);
  const result = [];
  let prev = 0;
  for (const p of pages) {
    if (p - prev > 1) result.push('…');
    result.push(p);
    prev = p;
  }
  return result;
}

function formatTime(value) {
  if (!value) return '--';
  const d = new Date(value);
  const now = Date.now();
  const diff = now - d.getTime();
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
  return d.toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || '请求失败');
  }
  return res.json();
}

function Toast({ message, error: isError, onDone }) {
  if (!message) return null;
  return (
    <motion.div
      className={`fixed top-6 left-1/2 z-50 px-5 py-3 rounded-lg border backdrop-blur-md text-sm shadow-lg
        ${isError
          ? 'border-red-500/30 bg-red-950/80 text-red-300'
          : 'border-primary/30 bg-dark-800/90 text-slate-200 shadow-primary/10'
        }`}
      style={{ transform: 'translateX(-50%)' }}
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <div className="flex items-center gap-2">
        {isError ? <X className="w-3.5 h-3.5 text-red-400" /> : <Zap className="w-3.5 h-3.5 text-primary" />}
        {message}
      </div>
    </motion.div>
  );
}

export default function App() {
  const [config, setConfig] = useState({ keywords: [], scope: '' });
  const [hotspots, setHotspots] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [health, setHealth] = useState({});
  const [newKeyword, setNewKeyword] = useState('');
  const [topicScope, setTopicScope] = useState('');
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushMessage, setPushMessage] = useState('');
  const [pushBusy, setPushBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortMode, setSortMode] = useState('relevance');
  const [selectedSources, setSelectedSources] = useState([]);
  const [expandedIds, setExpandedIds] = useState(() => new Set());
  const [copiedId, setCopiedId] = useState('');

  const availableSources = useMemo(() => {
    const counts = {};
    hotspots.forEach((item) => {
      const s = item.source || 'Unknown';
      counts[s] = (counts[s] || 0) + 1;
    });
    const ordered = [];
    SOURCES.forEach((s) => {
      if (counts[s]) ordered.push({ source: s, count: counts[s] });
    });
    Object.keys(counts).forEach((s) => {
      if (!SOURCES.includes(s)) ordered.push({ source: s, count: counts[s] });
    });
    return ordered;
  }, [hotspots]);

  const toggleSource = (s) => {
    setSelectedSources((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]
    );
  };

  const toggleExpand = (id) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const copyToClipboard = async (text, id) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId((cur) => (cur === id ? '' : cur)), 1500);
    } catch (err) {
      flash('复制失败：' + (err.message || '剪贴板不可用'), true);
    }
  };

  const formatExactTime = (value) => {
    if (!value) return '--';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '--';
    return d.toLocaleString('zh-CN', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    });
  };

  const filteredHotspots = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const tokens = q ? q.split(/\s+/).filter(Boolean) : [];
    const hasSourceFilter = selectedSources.length > 0;
    if (!tokens.length && !hasSourceFilter) return hotspots;
    return hotspots.filter((item) => {
      if (hasSourceFilter && !selectedSources.includes(item.source)) return false;
      if (tokens.length === 0) return true;
      const haystack = [
        item.title,
        item.summary,
        item.source,
        item.url,
        item.query,
        ...(Array.isArray(item.keywords) ? item.keywords : []),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return tokens.every((t) => haystack.includes(t));
    });
  }, [hotspots, searchQuery, selectedSources]);

  const sortedHotspots = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const tokens = q ? q.split(/\s+/).filter(Boolean) : [];
    const tsOf = (item) => {
      const t = item.createdAt ? new Date(item.createdAt).getTime() : 0;
      return Number.isFinite(t) ? t : 0;
    };
    const pubTsOf = (item) => {
      const raw = item.publishedAt || item.createdAt;
      const t = raw ? new Date(raw).getTime() : 0;
      return Number.isFinite(t) ? t : 0;
    };

    if (sortMode === 'hot') {
      return [...filteredHotspots].sort((a, b) => {
        const ca = a.confidence ?? 0;
        const cb = b.confidence ?? 0;
        if (cb !== ca) return cb - ca;
        return tsOf(b) - tsOf(a);
      });
    }

    if (sortMode === 'time') {
      return [...filteredHotspots].sort((a, b) => tsOf(b) - tsOf(a));
    }

    if (sortMode === 'published') {
      return [...filteredHotspots].sort((a, b) => {
        const pa = pubTsOf(a);
        const pb = pubTsOf(b);
        // 有原生发布时间的项优先于仅有收录时间的项
        const aHas = a.publishedAt ? 1 : 0;
        const bHas = b.publishedAt ? 1 : 0;
        if (aHas !== bHas) return bHas - aHas;
        return pb - pa;
      });
    }

    // relevance
    if (tokens.length === 0) {
      return [...filteredHotspots].sort((a, b) => tsOf(b) - tsOf(a));
    }
    const score = (item) => {
      const title = (item.title || '').toLowerCase();
      const summary = (item.summary || '').toLowerCase();
      const query = (item.query || '').toLowerCase();
      let s = 0;
      for (const t of tokens) {
        if (!t) continue;
        if (query === t) s += 8;
        else if (query.includes(t)) s += 4;
        if (title.includes(t)) s += 5;
        if (summary.includes(t)) s += 2;
        // 标题前缀加权
        if (title.startsWith(t)) s += 2;
      }
      return s;
    };
    return [...filteredHotspots].sort((a, b) => {
      const sa = score(a);
      const sb = score(b);
      if (sb !== sa) return sb - sa;
      return tsOf(b) - tsOf(a);
    });
  }, [filteredHotspots, sortMode, searchQuery]);

  const [currentPage, setCurrentPage] = useState(1);
  const listRef = useRef(null);

  const pageCount = Math.max(1, Math.ceil(sortedHotspots.length / PAGE_SIZE));
  const safePage = Math.min(Math.max(1, currentPage), pageCount);
  const paginatedHotspots = useMemo(
    () => sortedHotspots.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [sortedHotspots, safePage]
  );

  // 当筛选/排序/搜索发生变化导致总页数变小或上下文重置时，回到第 1 页
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, sortMode, selectedSources]);

  // 切页时把列表容器滚动到顶部
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = 0;
    }
  }, [safePage]);

  const goToPage = (n) => {
    const target = Math.min(Math.max(1, n), pageCount);
    setCurrentPage(target);
  };

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 18000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window) {
      navigator.serviceWorker.register('/service-worker.js')
        .then((reg) => reg.pushManager.getSubscription())
        .then((sub) => setPushEnabled(!!sub))
        .catch((err) => console.error('[push] 初始检测失败:', err));
    }
  }, []);

  const refresh = async () => {
    // 独立请求，一个失败不影响其他
    const fetcher = async (url) => {
      try { return await fetchJson(url); } catch (e) { console.error('[refresh] 请求失败:', url, e.message); return null; }
    };
    const [cfg, spots, notes, healthData] = await Promise.all([
      fetcher(API.config),
      fetcher(API.hotspots),
      fetcher(API.notifications),
      fetcher(API.health)
    ]);
    if (cfg) {
      setConfig(cfg);
      setTopicScope(cfg.scope || '');
    }
    if (spots) setHotspots(spots.hotspots || []);
    if (notes) setNotifications(notes.notifications || []);
    if (healthData) setHealth(healthData);
    console.log('[refresh] 热点', (spots?.hotspots || []).length, '通知', (notes?.notifications || []).length);
  };

  const flash = (msg, isErr) => {
    if (isErr) {
      setError(msg);
      setMessage('');
    } else {
      setMessage(msg);
      setError('');
    }
    setTimeout(() => {
      setError('');
      setMessage('');
    }, 3000);
  };

  const addKeyword = async () => {
    const kw = newKeyword.trim();
    if (!kw) return;
    if ((config.keywords || []).includes(kw)) {
      flash(`关键词「${kw}」已存在`, true);
      return;
    }
    setPending(true);
    setError('');
    setMessage('');
    try {
      const cfg = await fetchJson(API.keywords, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword: kw })
      });
      setConfig(cfg);
      setNewKeyword('');
      flash(`已添加「${kw}」`);
    } catch (err) {
      flash(err.message, true);
    } finally {
      setPending(false);
    }
  };

  const removeKeyword = async (keyword) => {
    setPending(true);
    try {
      const cfg = await fetchJson(`${API.keywords}/${encodeURIComponent(keyword)}`, { method: 'DELETE' });
      setConfig(cfg);
    } catch (err) {
      flash(err.message, true);
    } finally {
      setPending(false);
    }
  };

  const updateScope = async () => {
    setPending(true);
    try {
      const cfg = await fetchJson(API.scope, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope: topicScope.trim() })
      });
      setConfig(cfg);
      flash('监控范围已更新');
    } catch (err) {
      flash(err.message, true);
    } finally {
      setPending(false);
    }
  };

  const runScan = async () => {
    setScanning(true);
    setPending(true);
    try {
      const res = await fetchJson(API.scan, { method: 'POST' });
      flash(`扫描完成：候选 ${res.totalCandidates} 条，新增 ${res.newHotspots} 个热点`);
      await refresh();
    } catch (err) {
      flash(err.message, true);
    } finally {
      setPending(false);
      setScanning(false);
    }
  };

  const subscribePush = async () => {
    if (pushBusy) return;
    console.log('[push] 点击订阅按钮');
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      flash('浏览器不支持 Web Push', true);
      return;
    }
    if (Notification.permission === 'denied') {
      flash('请先在浏览器设置中允许通知', true);
      return;
    }
    setPushBusy(true);
    try {
      console.log('[push] 注册 service worker...');
      const reg = await navigator.serviceWorker.register('/service-worker.js');
      console.log('[push] SW 注册完成，等待 ready...');
      await navigator.serviceWorker.ready;
      console.log('[push] 检查现有订阅...');
      const existingSub = await reg.pushManager.getSubscription();
      if (existingSub) {
        console.log('[push] 取消旧订阅...');
        await existingSub.unsubscribe();
      }
      if (Notification.permission !== 'granted') {
        console.log('[push] 请求通知权限...');
        const perm = await Notification.requestPermission();
        if (perm !== 'granted') {
          flash('需要允许通知权限才能启用推送', true);
          return;
        }
      }
      console.log('[push] 获取 VAPID public key...');
      const { publicKey } = await fetchJson(API.pushKey);
      console.log('[push] 调用 pushManager.subscribe ...');
      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey)
      });
      console.log('[push] 上报订阅到后端...');
      await fetchJson(API.subscribe, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(subscription)
      });
      setPushEnabled(true);
      flash('推送订阅成功！');
      console.log('[push] 完成');
    } catch (err) {
      console.error('[push] 失败:', err);
      flash(err.message || '推送订阅失败', true);
    } finally {
      setPushBusy(false);
    }
  };

  const urlBase64ToUint8Array = (base64String) => {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
    return outputArray;
  };

  const handleKeywordKeyDown = (e) => {
    if (e.key === 'Enter') addKeyword();
  };

  return (
    <div className="relative min-h-screen bg-dark-900">
      <FloatingParticles />

      {/* Toast */}
      <Toast message={message} onDone={() => setMessage('')} />
      <Toast message={error} error onDone={() => setError('')} />

      <div className="relative z-10">
        {/* ========== HERO ========== */}
        <WavyBackground
          className="flex flex-col items-center justify-center text-center px-4 py-14 md:py-20"
          containerClassName="w-full"
          colors={['#06b6d4', '#6366f1', '#22d3ee', '#0ea5e9']}
          waveOpacity={0.3}
          speed="slow"
        >
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7 }}
          >
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-primary/30 bg-primary/5 text-xs text-primary-glow mb-4">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-primary-glow" />
              </span>
              实时监控中
            </div>
            <h1 className="text-4xl md:text-6xl font-bold text-gradient mb-3 tracking-tight">
              热点瞭望台
            </h1>
            <p className="text-slate-400 text-sm md:text-base max-w-md mx-auto mb-2">
              多源抓取 · AI 判真伪 · 实时推送
            </p>
            <p className="text-slate-600 text-xs">
              {config.lastScan ? `最后扫描 ${formatTime(config.lastScan)}` : '尚未扫描 · 点击下方按钮开始'}
            </p>
          </motion.div>
        </WavyBackground>

        {/* ========== STATS ========== */}
        <motion.div
          className="max-w-5xl mx-auto px-4 -mt-8 mb-6"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
        >
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <AnimatedCounter value={SOURCES.length} label="信息源" />
            <AnimatedCounter value={hotspots.length} label="已发现热点" />
            <AnimatedCounter value={notifications.length} label="通知记录" />
            <div className="stat-card">
              <Clock className="w-5 h-5 text-slate-500 mb-1" />
              <span className="text-xs text-slate-500 font-mono">
                {config.lastScan ? formatTime(config.lastScan) : '--'}
              </span>
              <span className="text-xs text-slate-600">上次扫描</span>
            </div>
          </div>
        </motion.div>

        {/* ========== PANELS ========== */}
        <motion.div
          className="max-w-5xl mx-auto px-4 mb-6"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.3 }}
        >
          <BentoGrid>
            {/* Config */}
            <BentoGridItem className="glow-border">
              <div className="flex items-center gap-2 mb-4">
                <Settings2 className="w-4 h-4 text-primary" />
                <h2 className="text-sm font-semibold text-slate-200">监控配置</h2>
              </div>

              <div className="mb-4">
                <label className="text-xs text-slate-500 mb-1.5 block">监控范围</label>
                <div className="flex gap-2">
                  <input
                    className="input-field flex-1"
                    value={topicScope}
                    onChange={(e) => setTopicScope(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && updateScope()}
                    placeholder="例如 AI 编程"
                  />
                  <button className="btn-secondary text-xs px-3" onClick={updateScope} disabled={pending}>
                    保存
                  </button>
                </div>
              </div>

              <div className="mb-3">
                <label className="text-xs text-slate-500 mb-1.5 block">
                  关键词 <span className="text-slate-600">({(config.keywords || []).length})</span>
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {(config.keywords || []).map((kw) => (
                    <span key={kw} className="tag-chip group">
                      {kw}
                      <button
                        onClick={() => removeKeyword(kw)}
                        className="opacity-0 group-hover:opacity-100 transition-opacity text-slate-500 hover:text-red-400"
                        aria-label={`删除 ${kw}`}
                        disabled={pending}
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
              </div>

              <div className="flex gap-2">
                <input
                  className="input-field flex-1"
                  value={newKeyword}
                  onChange={(e) => setNewKeyword(e.target.value)}
                  onKeyDown={handleKeywordKeyDown}
                  placeholder="输入关键词，回车添加"
                />
                <button
                  className="btn-secondary text-xs px-3"
                  onClick={addKeyword}
                  disabled={pending || !newKeyword.trim()}
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
            </BentoGridItem>

            {/* Actions */}
            <BentoGridItem className="glow-border flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-2 mb-4">
                  <Zap className="w-4 h-4 text-primary" />
                  <h2 className="text-sm font-semibold text-slate-200">快速操作</h2>
                </div>

                <div className="mb-4">
                  <Sparkles>
                    <button
                      className="btn-primary w-full py-3 text-base"
                      onClick={runScan}
                      disabled={scanning || pending}
                    >
                      {scanning ? (
                        <>
                          <motion.div
                            className="w-4 h-4 border-2 border-white border-t-transparent rounded-full"
                            animate={{ rotate: 360 }}
                            transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                          />
                          扫描中...
                        </>
                      ) : (
                        <>
                          <Search className="w-4 h-4" />
                          立即扫描
                        </>
                      )}
                    </button>
                  </Sparkles>
                </div>

                <div className="mb-4">
                  <label className="text-xs text-slate-500 mb-2 block">多源采集</label>
                  <div className="flex flex-wrap gap-1.5">
                    {SOURCES.map((s) => (
                      <span key={s} className="source-chip">
                        <Globe className="w-3 h-3" />
                        {s}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="space-y-1.5 mb-4">
                  {[
                    { key: 'deepseekConfigured', label: 'DeepSeek AI' },
                    { key: 'twitterConfigured', label: 'Twitter API' },
                    { key: 'emailConfigured', label: '邮件通知' },
                  ].map((item) => (
                    <div key={item.key} className="flex items-center gap-2 text-xs">
                      <span className={`w-1.5 h-1.5 rounded-full ${health[item.key] ? 'bg-primary shadow-[0_0_6px_rgba(6,182,212,0.5)]' : 'bg-slate-700'}`} />
                      <span className="text-slate-500 flex-1">{item.label}</span>
                      <span className="text-[10px] text-slate-600">{health[item.key] ? 'ON' : 'OFF'}</span>
                    </div>
                  ))}
                </div>
              </div>

              <button
                className={pushEnabled ? 'btn-secondary w-full text-xs' : 'btn-primary w-full text-xs'}
                onClick={subscribePush}
                disabled={pushBusy}
              >
                {pushBusy ? (
                  <>
                    <motion.div
                      className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full"
                      animate={{ rotate: 360 }}
                      transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                    />
                    订阅中...
                  </>
                ) : (
                  <>
                    <Bell className="w-3.5 h-3.5" />
                    {pushEnabled ? '推送已启用 (点击重新订阅)' : '启用浏览器推送'}
                  </>
                )}
              </button>
              {pushMessage && <p className="text-xs text-slate-500 mt-1.5 text-center">{pushMessage}</p>}
            </BentoGridItem>
          </BentoGrid>
        </motion.div>

        {/* ========== HOTSPOTS & NOTIFICATIONS ========== */}
        <motion.div
          className="max-w-5xl mx-auto px-4 pb-12"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.4 }}
        >
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Hotspots 2/3 */}
            <div className="lg:col-span-2">
              <div className="flex items-center gap-2 mb-3">
                <TrendingUp className="w-4 h-4 text-primary" />
                <h2 className="text-sm font-semibold text-slate-200">最新热点</h2>
                <span className="text-xs text-slate-600">
                  {(searchQuery.trim() || selectedSources.length > 0)
                    ? `(${filteredHotspots.length}/${hotspots.length})`
                    : `(${hotspots.length})`}
                </span>
                {paginatedHotspots.length > 0 && (() => {
                  const allExpanded = paginatedHotspots.every((it) => expandedIds.has(it.id));
                  const handleToggleAll = () => {
                    setExpandedIds((prev) => {
                      const next = new Set(prev);
                      if (allExpanded) {
                        paginatedHotspots.forEach((it) => next.delete(it.id));
                      } else {
                        paginatedHotspots.forEach((it) => next.add(it.id));
                      }
                      return next;
                    });
                  };
                  return (
                    <button
                      type="button"
                      onClick={handleToggleAll}
                      className="ml-auto inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded-md border border-white/[0.08] bg-white/[0.03] text-slate-400 hover:text-primary-glow hover:border-primary/40 hover:bg-primary/10 transition-colors"
                      title={allExpanded ? '折叠当前页全部条目' : '展开当前页全部条目'}
                    >
                      {allExpanded ? (
                        <>
                          <ChevronsDownUp className="w-3 h-3" />
                          全部折叠
                        </>
                      ) : (
                        <>
                          <ChevronsUpDown className="w-3 h-3" />
                          全部展开
                        </>
                      )}
                    </button>
                  );
                })()}
              </div>

              <div className="relative mb-3">
                <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  className="input-field pl-9 pr-9 text-xs py-2"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="搜索已发现的热点（标题、摘要、来源、关键词）"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-white/[0.06] text-slate-500 hover:text-slate-300 transition-colors"
                    aria-label="清空搜索"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>

              <div className="flex items-center justify-between gap-2 mb-3">
                <div className="inline-flex rounded-lg border border-white/[0.08] bg-white/[0.03] p-0.5 text-xs">
                  <button
                    type="button"
                    onClick={() => setSortMode('relevance')}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md transition-colors ${
                      sortMode === 'relevance'
                        ? 'bg-primary/15 text-primary-glow'
                        : 'text-slate-500 hover:text-slate-300'
                    }`}
                    title="按相关性排序（有搜索词时按匹配度，否则按时间）"
                  >
                    <ArrowDownWideNarrow className="w-3 h-3" />
                    相关性
                  </button>
                  <button
                    type="button"
                    onClick={() => setSortMode('hot')}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md transition-colors ${
                      sortMode === 'hot'
                        ? 'bg-primary/15 text-primary-glow'
                        : 'text-slate-500 hover:text-slate-300'
                    }`}
                    title="按热度排序（AI 置信度）"
                  >
                    <Flame className="w-3 h-3" />
                    热度
                  </button>
                  <button
                    type="button"
                    onClick={() => setSortMode('time')}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md transition-colors ${
                      sortMode === 'time'
                        ? 'bg-primary/15 text-primary-glow'
                        : 'text-slate-500 hover:text-slate-300'
                    }`}
                    title="按收录时间排序（扫描发现时间，最新在前）"
                  >
                    <Clock className="w-3 h-3" />
                    收录
                  </button>
                  <button
                    type="button"
                    onClick={() => setSortMode('published')}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md transition-colors ${
                      sortMode === 'published'
                        ? 'bg-primary/15 text-primary-glow'
                        : 'text-slate-500 hover:text-slate-300'
                    }`}
                    title="按信息发布时间排序（来自来源的原始时间，缺失则回退收录时间）"
                  >
                    <CalendarClock className="w-3 h-3" />
                    发布
                  </button>
                </div>
                <span className="text-[10px] text-slate-600">
                  {sortMode === 'hot'
                    ? '按置信度'
                    : sortMode === 'time'
                    ? '按收录时间'
                    : sortMode === 'published'
                    ? '按发布时间'
                    : searchQuery.trim()
                    ? '按匹配度'
                    : '按收录时间'}
                </span>
              </div>

              {availableSources.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 mb-3">
                  <span className="text-[10px] text-slate-600 mr-0.5">来源:</span>
                  {availableSources.map(({ source, count }) => {
                    const active = selectedSources.includes(source);
                    return (
                      <button
                        key={source}
                        type="button"
                        onClick={() => toggleSource(source)}
                        className={`text-[10px] px-2 py-0.5 rounded-md border transition-colors ${
                          active
                            ? 'bg-primary/15 text-primary-glow border-primary/40'
                            : 'bg-white/[0.04] text-slate-400 border-white/[0.08] hover:bg-white/[0.08] hover:text-slate-200'
                        }`}
                      >
                        {source}
                        <span className="ml-1 opacity-60">{count}</span>
                      </button>
                    );
                  })}
                  {selectedSources.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setSelectedSources([])}
                      className="text-[10px] px-2 py-0.5 rounded-md text-slate-500 hover:text-slate-300 transition-colors inline-flex items-center gap-1"
                    >
                      <X className="w-2.5 h-2.5" />
                      清除
                    </button>
                  )}
                </div>
              )}

              <div ref={listRef} className="space-y-3 max-h-[70vh] overflow-y-auto pr-1">
                {paginatedHotspots.map((item, idx) => {
                  const isExpanded = expandedIds.has(item.id);
                  return (
                  <motion.div
                    key={item.id}
                    className="hotspot-item rounded-xl"
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, delay: Math.min(idx * 0.03, 0.3) }}
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                            item.source === 'HackerNews'
                              ? 'bg-orange-500/10 text-orange-400 border border-orange-500/20'
                              : item.source === 'Sogou'
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                              : item.source === 'WeChat'
                              ? 'bg-green-500/10 text-green-400 border border-green-500/20'
                              : item.source === 'Twitter'
                              ? 'bg-sky-500/10 text-sky-400 border border-sky-500/20'
                              : item.source === 'Bing News'
                              ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                              : item.source === 'Bilibili'
                              ? 'bg-pink-500/10 text-pink-400 border border-pink-500/20'
                              : 'bg-primary/10 text-primary border border-primary/20'
                          }`}>
                            {item.source}
                          </span>
                          {item.query && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSearchQuery(item.query);
                              }}
                              className={`text-[10px] px-1.5 py-0.5 rounded font-medium border transition-colors ${
                                searchQuery.trim().toLowerCase() === item.query.toLowerCase()
                                  ? 'bg-primary/20 text-primary-glow border-primary/40'
                                  : 'bg-white/[0.04] text-slate-400 border-white/[0.08] hover:bg-primary/10 hover:text-primary-glow hover:border-primary/30'
                              }`}
                              title={`筛选关键词「${item.query}」`}
                            >
                              # {item.query}
                            </button>
                          )}
                          <span className="text-[10px] text-slate-600" title="收录时间（扫描发现时间）">{formatTime(item.createdAt)}</span>
                          {item.publishedAt && (
                            <span
                              className="text-[10px] text-slate-500"
                              title={`发布时间：${new Date(item.publishedAt).toLocaleString('zh-CN')}`}
                            >
                              · 发布 {formatTime(item.publishedAt)}
                            </span>
                          )}
                        </div>
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noreferrer"
                          className={`text-sm font-medium text-slate-200 hover:text-primary-glow transition-colors inline-flex items-start gap-1 group ${isExpanded ? '' : 'line-clamp-2'}`}
                        >
                          {item.title}
                          <ExternalLink className="w-3 h-3 mt-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-primary" />
                        </a>
                        <p className={`text-xs text-slate-500 mt-1 ${isExpanded ? 'whitespace-pre-line' : 'line-clamp-2'}`}>{item.summary}</p>
                        <div className="mt-2 flex items-center gap-2">
                          <div className="flex-1 h-1 bg-white/[0.06] rounded-full overflow-hidden">
                            <motion.div
                              className="h-full rounded-full"
                              style={{
                                background: `linear-gradient(90deg, ${item.confidence >= 0.8 ? '#06b6d4, #22d3ee' : item.confidence >= 0.5 ? '#6366f1, #818cf8' : '#64748b, #94a3b8'})`
                              }}
                              initial={{ width: 0 }}
                              animate={{ width: `${Math.min(Math.max(item.confidence || 0, 0), 1) * 100}%` }}
                              transition={{ duration: 0.8, ease: 'easeOut' }}
                            />
                          </div>
                          <span className="text-[10px] text-slate-500 font-mono w-8 text-right">
                            {Math.round((item.confidence || 0) * 100)}%
                          </span>
                          <button
                            type="button"
                            onClick={() => toggleExpand(item.id)}
                            className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md text-slate-500 hover:text-primary-glow hover:bg-primary/10 transition-colors"
                            title={isExpanded ? '折叠' : '展开更多信息'}
                            aria-expanded={isExpanded}
                          >
                            <motion.span
                              animate={{ rotate: isExpanded ? 180 : 0 }}
                              transition={{ duration: 0.2 }}
                              className="inline-flex"
                            >
                              <ChevronDown className="w-3 h-3" />
                            </motion.span>
                            {isExpanded ? '收起' : '展开'}
                          </button>
                        </div>

                        <AnimatePresence initial={false}>
                          {isExpanded && (
                            <motion.div
                              key="expanded"
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: 'auto' }}
                              exit={{ opacity: 0, height: 0 }}
                              transition={{ duration: 0.25, ease: 'easeOut' }}
                              className="overflow-hidden"
                            >
                              <div className="mt-3 pt-3 border-t border-white/[0.06] space-y-3">
                                {item.reason && (
                                  <div>
                                    <div className="flex items-center gap-1.5 mb-1.5">
                                      <WandSparkles className="w-3 h-3 text-primary" />
                                      <span className="text-[10px] uppercase tracking-wider text-primary-glow font-semibold">AI 判定理由</span>
                                    </div>
                                    <p className="text-xs text-slate-400 leading-relaxed bg-primary/[0.04] border border-primary/[0.12] rounded-md p-2">
                                      {item.reason}
                                    </p>
                                  </div>
                                )}

                                <div>
                                  <div className="flex items-center gap-1.5 mb-1.5">
                                    <Sparkle className="w-3 h-3 text-slate-500" />
                                    <span className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">详细信息</span>
                                  </div>
                                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
                                    <div className="flex items-baseline gap-1.5">
                                      <span className="text-slate-600 shrink-0">收录</span>
                                      <span className="text-slate-300 font-mono">{formatExactTime(item.createdAt)}</span>
                                    </div>
                                    <div className="flex items-baseline gap-1.5">
                                      <span className="text-slate-600 shrink-0">发布</span>
                                      <span className="text-slate-300 font-mono">{item.publishedAt ? formatExactTime(item.publishedAt) : '未提供'}</span>
                                    </div>
                                    <div className="flex items-baseline gap-1.5">
                                      <span className="text-slate-600 shrink-0">触发</span>
                                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                        item.trigger === 'manual'
                                          ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                                          : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                      }`}>
                                        {item.trigger === 'manual' ? '手动扫描' : '定时自动'}
                                      </span>
                                    </div>
                                    <div className="flex items-baseline gap-1.5">
                                      <span className="text-slate-600 shrink-0">置信</span>
                                      <span className="text-slate-300 font-mono">{((item.confidence || 0)).toFixed(2)}</span>
                                    </div>
                                  </div>
                                </div>

                                <div>
                                  <div className="flex items-center gap-1.5 mb-1.5">
                                    <Link2 className="w-3 h-3 text-slate-500" />
                                    <span className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">原文链接</span>
                                  </div>
                                  <div className="flex items-stretch gap-1.5">
                                    <a
                                      href={item.url}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="flex-1 min-w-0 text-[11px] font-mono text-slate-400 hover:text-primary-glow bg-white/[0.03] border border-white/[0.06] rounded-md px-2 py-1.5 truncate transition-colors"
                                      title={item.url}
                                    >
                                      {item.url}
                                    </a>
                                    <button
                                      type="button"
                                      onClick={() => copyToClipboard(item.url, item.id)}
                                      className="inline-flex items-center justify-center w-7 shrink-0 rounded-md border border-white/[0.08] bg-white/[0.03] text-slate-400 hover:text-primary-glow hover:border-primary/30 hover:bg-primary/10 transition-colors"
                                      title="复制链接"
                                    >
                                      {copiedId === item.id ? (
                                        <Check className="w-3 h-3 text-emerald-400" />
                                      ) : (
                                        <Copy className="w-3 h-3" />
                                      )}
                                    </button>
                                    <a
                                      href={item.url}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="inline-flex items-center justify-center w-7 shrink-0 rounded-md border border-white/[0.08] bg-white/[0.03] text-slate-400 hover:text-primary-glow hover:border-primary/30 hover:bg-primary/10 transition-colors"
                                      title="在新标签打开"
                                    >
                                      <ExternalLink className="w-3 h-3" />
                                    </a>
                                  </div>
                                </div>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    </div>
                  </motion.div>
                  );
                })}
                {hotspots.length === 0 && (
                  <div className="glass-card p-8 text-center">
                    <Layers className="w-8 h-8 text-slate-700 mx-auto mb-3" />
                    <p className="text-slate-500 text-sm">暂无热点数据</p>
                    <p className="text-slate-600 text-xs mt-1">添加关键词并执行扫描即可发现热点</p>
                  </div>
                )}
                {hotspots.length > 0 && filteredHotspots.length === 0 && (
                  <div className="glass-card p-8 text-center">
                    <Search className="w-8 h-8 text-slate-700 mx-auto mb-3" />
                    <p className="text-slate-500 text-sm">未找到匹配的热点</p>
                    <p className="text-slate-600 text-xs mt-1">尝试其他关键词，或调整/清除来源筛选</p>
                  </div>
                )}
              </div>

              {sortedHotspots.length > 0 && (
                <div className="flex items-center justify-between gap-3 mt-3 pt-3 border-t border-white/[0.05] text-[11px]">
                  <span className="text-slate-600">
                    共 <span className="text-slate-400 font-medium">{sortedHotspots.length}</span> 条
                    {pageCount > 1 && (
                      <>
                        {' · 第 '}
                        <span className="text-slate-400 font-medium">{safePage}</span>
                        {' / '}
                        <span className="text-slate-400 font-medium">{pageCount}</span>
                        {' 页'}
                      </>
                    )}
                  </span>
                  {pageCount > 1 && (
                    <div className="flex items-center gap-0.5">
                      <button
                        type="button"
                        onClick={() => goToPage(safePage - 1)}
                        disabled={safePage <= 1}
                        className="w-6 h-6 inline-flex items-center justify-center rounded-md text-slate-400 hover:text-slate-200 hover:bg-white/[0.06] disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent transition-colors"
                        aria-label="上一页"
                      >
                        <ChevronLeft className="w-3 h-3" />
                      </button>
                      {buildPageRange(safePage, pageCount).map((p, i) =>
                        p === '…' ? (
                          <span key={`ellipsis-${i}`} className="px-1 text-slate-600">…</span>
                        ) : (
                          <button
                            key={p}
                            type="button"
                            onClick={() => goToPage(p)}
                            className={`min-w-[1.5rem] h-6 px-1.5 inline-flex items-center justify-center rounded-md font-mono transition-colors ${
                              p === safePage
                                ? 'bg-primary/15 text-primary-glow'
                                : 'text-slate-500 hover:text-slate-200 hover:bg-white/[0.06]'
                            }`}
                          >
                            {p}
                          </button>
                        )
                      )}
                      <button
                        type="button"
                        onClick={() => goToPage(safePage + 1)}
                        disabled={safePage >= pageCount}
                        className="w-6 h-6 inline-flex items-center justify-center rounded-md text-slate-400 hover:text-slate-200 hover:bg-white/[0.06] disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent transition-colors"
                        aria-label="下一页"
                      >
                        <ChevronRight className="w-3 h-3" />
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Notifications 1/3 */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Bell className="w-4 h-4 text-primary" />
                <h2 className="text-sm font-semibold text-slate-200">最近通知</h2>
                <span className="text-xs text-slate-600">({notifications.length})</span>
              </div>

              <div className="space-y-2 max-h-[70vh] overflow-y-auto pr-1">
                {[...notifications].reverse().slice(0, 12).map((item, idx) => (
                  <motion.a
                    key={item.id}
                    href={item.url}
                    target="_blank"
                    rel="noreferrer"
                    className="glass-card-hover p-3 block"
                    initial={{ opacity: 0, x: 10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.3, delay: Math.min(idx * 0.04, 0.4) }}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                        item.source === 'HackerNews' ? 'bg-orange-500/10 text-orange-400'
                        : item.source === 'Sogou' ? 'bg-emerald-500/10 text-emerald-400'
                        : item.source === 'WeChat' ? 'bg-green-500/10 text-green-400'
                        : item.source === 'Twitter' ? 'bg-sky-500/10 text-sky-400'
                        : item.source === 'Bilibili' ? 'bg-pink-500/10 text-pink-400'
                        : 'bg-primary/10 text-primary'
                      }`}>
                        {item.source}
                      </span>
                    </div>
                    <p className="text-xs text-slate-300 line-clamp-2 leading-relaxed">{item.title}</p>
                    <p className="text-[10px] text-slate-600 mt-1">{formatTime(item.createdAt)}</p>
                  </motion.a>
                ))}
                {notifications.length === 0 && (
                  <div className="glass-card p-6 text-center">
                    <Activity className="w-6 h-6 text-slate-700 mx-auto mb-2" />
                    <p className="text-slate-500 text-xs">暂无通知</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </motion.div>

        <div className="max-w-5xl mx-auto px-4 pb-8 text-center">
          <p className="text-[10px] text-slate-700">
            Powered by DeepSeek AI · Bing · DuckDuckGo · Bing News · Twitter/X · {new Date().getFullYear()}
          </p>
        </div>
      </div>
    </div>
  );
}
