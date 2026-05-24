import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Search, Zap, Settings2, Radio, Bell, Plus, X, ExternalLink,
  TrendingUp, Activity, Clock, Globe, Layers
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

const SOURCES = ['Bing', 'Bing News', 'Sogou', 'Sogou 微信', 'HackerNews', 'Twitter'];

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
  const [scanning, setScanning] = useState(false);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 18000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window) {
      navigator.serviceWorker.getRegistration().then((reg) => {
        if (reg) {
          reg.pushManager.getSubscription().then((sub) => {
            setPushEnabled(!!sub);
          });
        }
      });
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
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      flash('浏览器不支持 Web Push', true);
      return;
    }
    if (Notification.permission === 'denied') {
      flash('请先在浏览器设置中允许通知', true);
      return;
    }
    try {
      const reg = await navigator.serviceWorker.register('/service-worker.js');
      // 如果存在旧订阅（如 VAPID 密钥更换后），先取消
      const existingSub = await reg.pushManager.getSubscription();
      if (existingSub) {
        await existingSub.unsubscribe();
      }
      // 请求通知权限（如果尚未授权）
      if (Notification.permission !== 'granted') {
        const perm = await Notification.requestPermission();
        if (perm !== 'granted') {
          flash('需要允许通知权限才能启用推送', true);
          return;
        }
      }
      const { publicKey } = await fetchJson(API.pushKey);
      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey)
      });
      await fetchJson(API.subscribe, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(subscription)
      });
      setPushEnabled(true);
      flash('推送订阅成功！');
    } catch (err) {
      flash(err.message, true);
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
              >
                <Bell className="w-3.5 h-3.5" />
                {pushEnabled ? '推送已启用 (点击重新订阅)' : '启用浏览器推送'}
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
                <span className="text-xs text-slate-600">({hotspots.length})</span>
              </div>

              <div className="space-y-3 max-h-[70vh] overflow-y-auto pr-1">
                {hotspots.slice(0, 20).map((item, idx) => (
                  <motion.div
                    key={item.id}
                    className="hotspot-item rounded-xl"
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, delay: Math.min(idx * 0.03, 0.3) }}
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
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
                              : 'bg-primary/10 text-primary border border-primary/20'
                          }`}>
                            {item.source}
                          </span>
                          <span className="text-[10px] text-slate-600">{formatTime(item.createdAt)}</span>
                        </div>
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-sm font-medium text-slate-200 hover:text-primary-glow transition-colors line-clamp-2 inline-flex items-start gap-1 group"
                        >
                          {item.title}
                          <ExternalLink className="w-3 h-3 mt-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-primary" />
                        </a>
                        <p className="text-xs text-slate-500 mt-1 line-clamp-2">{item.summary}</p>
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
                        </div>
                      </div>
                    </div>
                  </motion.div>
                ))}
                {hotspots.length === 0 && (
                  <div className="glass-card p-8 text-center">
                    <Layers className="w-8 h-8 text-slate-700 mx-auto mb-3" />
                    <p className="text-slate-500 text-sm">暂无热点数据</p>
                    <p className="text-slate-600 text-xs mt-1">添加关键词并执行扫描即可发现热点</p>
                  </div>
                )}
              </div>
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
