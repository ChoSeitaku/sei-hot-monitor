import { useEffect, useMemo, useState } from 'react';

const api = {
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

function formatTime(value) {
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || '请求失败');
  }
  return res.json();
}

function App() {
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

  const sourceList = useMemo(() => ['Bing', 'DuckDuckGo', 'Bing News', 'Twitter'], []);

  useEffect(() => {
    refresh();
    const timer = setInterval(() => refresh(), 16000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
      setPushEnabled(Notification.permission === 'granted');
    }
  }, []);

  const refresh = async () => {
    try {
      const [cfg, spots, notes, healthData] = await Promise.all([
        fetchJson(api.config),
        fetchJson(api.hotspots),
        fetchJson(api.notifications),
        fetchJson(api.health)
      ]);
      setConfig(cfg);
      setHotspots(spots.hotspots || []);
      setNotifications(notes.notifications || []);
      setTopicScope(cfg.scope || '');
      setHealth(healthData);
    } catch (err) {
      setError(err.message || '刷新失败');
    }
  };

  const addKeyword = async () => {
    if (!newKeyword.trim()) return;
    setPending(true);
    setError('');
    try {
      const cfg = await fetchJson(api.keywords, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword: newKeyword.trim() })
      });
      setConfig(cfg);
      setNewKeyword('');
      setMessage('已添加监控关键词');
    } catch (err) {
      setError(err.message);
    } finally {
      setPending(false);
    }
  };

  const removeKeyword = async (keyword) => {
    setPending(true);
    setError('');
    try {
      const cfg = await fetchJson(`${api.keywords}/${encodeURIComponent(keyword)}`, { method: 'DELETE' });
      setConfig(cfg);
      setMessage('关键词已删除');
    } catch (err) {
      setError(err.message);
    } finally {
      setPending(false);
    }
  };

  const updateScope = async () => {
    setPending(true);
    setError('');
    try {
      const cfg = await fetchJson(api.scope, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope: topicScope.trim() })
      });
      setConfig(cfg);
      setMessage('监控范围已更新');
    } catch (err) {
      setError(err.message);
    } finally {
      setPending(false);
    }
  };

  const runScan = async () => {
    setPending(true);
    setError('');
    try {
      const res = await fetchJson(api.scan, { method: 'POST' });
      setMessage(`完成扫描：候选 ${res.totalCandidates} 条，发现 ${res.newHotspots} 个热点`);
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setPending(false);
    }
  };

  const subscribePush = async () => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      setPushMessage('浏览器不支持 Web Push');
      return;
    }
    if (Notification.permission === 'denied') {
      setPushMessage('请先允许浏览器通知');
      return;
    }
    try {
      const reg = await navigator.serviceWorker.register('/service-worker.js');
      const { publicKey } = await fetchJson(api.pushKey);
      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey)
      });
      await fetchJson(api.subscribe, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(subscription)
      });
      setPushEnabled(true);
      setPushMessage('浏览器推送订阅成功');
    } catch (err) {
      setPushMessage(err.message || '订阅失败');
    }
  };

  const urlBase64ToUint8Array = (base64String) => {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  };

  return (
    <div className="app-shell">
      <header className="hero-panel">
        <div>
          <h1>热点瞭望台</h1>
          <p>多源 AI 热点监控，结合网页搜索与 Twitter 数据，使用 AI 判真伪并实时通知。</p>
        </div>
        <div className="hero-badge">实时监控</div>
      </header>

      <section className="grid-panel">
        <article className="card spotlight-card">
          <h2>当前配置</h2>
          <div className="field-row">
            <label>监控范围</label>
            <input value={topicScope} onChange={(e) => setTopicScope(e.target.value)} placeholder="例如 AI 编程" />
            <button onClick={updateScope} disabled={pending}>保存</button>
          </div>
          <div className="field-row">
            <label>关键词列表</label>
            <div className="tag-list">
              {(config.keywords || []).map((item) => (
                <span key={item} className="tag-item">
                  {item}
                  <button onClick={() => removeKeyword(item)} aria-label={`删除 ${item}`}>×</button>
                </span>
              ))}
            </div>
          </div>
          <div className="field-row">
            <input value={newKeyword} onChange={(e) => setNewKeyword(e.target.value)} placeholder="新关键词，按按钮添加" />
            <button onClick={addKeyword} disabled={pending}>添加关键词</button>
          </div>
          <div className="metadata-row">
            <span>最后扫描：{config.lastScan ? formatTime(config.lastScan) : '尚未扫描'}</span>
            <span>OpenRouter：{health.openRouterConfigured ? '已配置' : '未配置'}</span>
            <span>Twitter API：{health.twitterConfigured ? '已配置' : '未配置'}</span>
          </div>
        </article>

        <article className="card quick-action-card">
          <h2>快速操作</h2>
          <button className="button-primary" onClick={runScan} disabled={pending}>立即扫描</button>
          <div className="stats-grid">
            <div>
              <strong>{sourceList.length}</strong>
              <p>信息源</p>
            </div>
            <div>
              <strong>{hotspots.length}</strong>
              <p>已发现热点</p>
            </div>
            <div>
              <strong>{notifications.length}</strong>
              <p>通知记录</p>
            </div>
          </div>
          <div className="chips-row">
            {sourceList.map((item) => (
              <span key={item} className="chip">{item}</span>
            ))}
          </div>
          <div className="field-row">
            <button onClick={subscribePush} disabled={pushEnabled} className="button-secondary">{pushEnabled ? '已启用推送' : '启用浏览器推送'}</button>
            {pushMessage && <small>{pushMessage}</small>}
          </div>
        </article>
      </section>

      {message && <div className="toast success">{message}</div>}
      {error && <div className="toast error">{error}</div>}

      <section className="grid-panel">
        <article className="card feed-card">
          <h2>最新通知</h2>
          <div className="feed-list">
            {notifications.slice(0, 6).map((item) => (
              <a key={item.id} className="feed-item" href={item.url} target="_blank" rel="noreferrer">
                <div>
                  <span>{item.source}</span>
                  <strong>{item.title}</strong>
                </div>
                <small>{formatTime(item.createdAt)}</small>
              </a>
            ))}
            {notifications.length === 0 && <p className="empty-state">尚无通知，先点击“立即扫描”试试。</p>}
          </div>
        </article>

        <article className="card history-card">
          <h2>热点列表</h2>
          <div className="history-list">
            {hotspots.slice(0, 10).map((item) => (
              <div key={item.id} className="history-item">
                <div className="history-title">
                  <a href={item.url} target="_blank" rel="noreferrer">{item.title}</a>
                  <span>{item.source}</span>
                </div>
                <p>{item.summary}</p>
                <div className="history-meta">
                  <span>{item.query}</span>
                  <span>{formatTime(item.createdAt)}</span>
                </div>
              </div>
            ))}
            {hotspots.length === 0 && <p className="empty-state">暂无热点，请先添加关键词并执行扫描。</p>}
          </div>
        </article>
      </section>
    </div>
  );
}

export default App;
