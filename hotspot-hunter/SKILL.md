---
name: hotspot-hunter
description: Multi-source web hotspot discovery tool. Scrapes Bing, Bing News, DuckDuckGo, Sogou, WeChat, Bilibili, and HackerNews simultaneously to find trending content on any topic. Use this skill whenever the user wants to search for hot topics, trending news, monitor keywords across search engines, discover what people are saying about a subject, track emerging trends, or do competitive research across multiple platforms at once. Also use when the user asks "what's hot right now about X", "find trending articles on Y", "monitor Z across the web", or similar multi-source discovery tasks.
---

# Hotspot Hunter

Multi-source web hotspot discovery. No API keys, no servers, no databases required.

## How it works

1. **User provides a topic or keywords** — e.g. "AI coding tools", "React 19", "量子计算"
2. **Run the bundled scraper** — `node scripts/scout.js` queries 7 free search engines in parallel
3. **Claude analyzes the results** — you read the JSON output and evaluate each candidate for newsworthiness, recency, and credibility
4. **Present structured findings** — a ranked list of genuine hotspots with supporting evidence

## Scraper usage

```bash
node scripts/scout.js --query "<keywords>" [--sources src1,src2] [--max N]
```

**Options:**

| Flag | Default | Description |
|------|---------|-------------|
| `-q, --query` | *(required)* | Search keywords |
| `-s, --sources` | `bing,bing-news,ddg,sogou,wechat,bilibili,hackernews` | Comma-separated source list |
| `-m, --max` | `10` | Max results per source |
| `-h, --help` | — | Show help |

**Available sources:**

| Source ID | Platform | Notes |
|-----------|----------|-------|
| `bing` | Bing Web | General web search |
| `bing-news` | Bing News | News articles with timestamps |
| `ddg` | DuckDuckGo | Privacy-focused web results |
| `sogou` | Sogou (搜狗) | Chinese web search |
| `wechat` | Sogou WeChat (搜狗微信) | WeChat public account articles |
| `bilibili` | Bilibili (B站) | Video platform search with WBI auth |
| `hackernews` | HackerNews | Tech community (Algolia API) |

**Examples:**

```bash
# Broad search across all sources
node scripts/scout.js --query "AI coding tools"

# Targeted search, more results per source
node scripts/scout.js -q "Claude Code" -m 15

# Chinese sources only
node scripts/scout.js -q "大模型" -s sogou,wechat,bilibili

# Tech-only research
node scripts/scout.js -q "rust web framework" -s hackernews,bing-news,bing
```

Before running, ensure dependencies are installed:
```bash
cd <skill-path>/scripts && npm install
```

## Output format

The scraper writes JSON to stdout:

```json
{
  "query": "AI coding tools",
  "sources": ["bing", "bing-news", "hackernews"],
  "perSource": { "bing": 10, "bing-news": 8, "hackernews": 10 },
  "total": 28,
  "candidates": [
    {
      "source": "bing-news",
      "query": "AI coding tools",
      "title": "Cursor announces major update with agent mode",
      "url": "https://example.com/cursor-update",
      "publishedAt": "2026-05-25T10:30:00.000Z",
      "meta": null
    }
  ]
}
```

## Analysis workflow

After running the scraper, you (Claude) perform the hotspot analysis:

### Step 1 — Filter noise
Remove candidates that are clearly not hotspots:
- Aggregator / directory pages (e.g. "Top 10 AI tools in 2025")
- Low-quality SEO spam or marketing landing pages
- Pages with no substantial content
- Duplicate or near-duplicate entries

### Step 2 — Score each candidate
Evaluate on these dimensions (0.0–1.0):

| Dimension | What to look for |
|-----------|-----------------|
| **Recency** | Is this from the last few days/weeks? Items with `publishedAt` dates get a baseline advantage. |
| **Significance** | New product launch, version release, research breakthrough, industry event, major community discussion. Routine content scores low. |
| **Credibility** | Source reputation matters. HackerNews front-page stories, official announcements, major tech publications > random blog spam. |
| **Relevance** | How closely does this match the user's topic? Exact match > adjacent > tangential. |

### Step 3 — Assign confidence
Combine dimensions into an overall confidence score:
- **0.8–1.0**: Clearly significant and recent. Multiple signals confirm this is hot.
- **0.5–0.8**: Likely interesting. Some signals present but not overwhelming.
- **0.3–0.5**: Possibly worth noting. Weak signals or single-source only.
- **<0.3**: Skip these unless the user asked for exhaustive results.

### Step 4 — Present findings

Use this output structure:

```
## 热点扫描结果: <topic>

**扫描概况**: <N> sources scanned, <M> candidates found, <K> identified as hotspots

### 高热度 (confidence ≥ 0.8)
| # | 标题 | 来源 | 时间 | 热度信号 | 置信度 |
|---|------|------|------|----------|--------|
| 1 | [Cursor 发布 Agent Mode 重大更新](https://example.com) | HN | 2h ago | 75 points / 48 comments，正式支持自主代理模式 | 0.92 |
| 2 | [Another Hotspot](https://example.com) | Bing News | 5h ago | Official product launch announcement | 0.85 |

**快速跳转:**
- [Cursor 发布 Agent Mode 重大更新](https://example.com)
- [Another Hotspot](https://example.com)

### 中等热度 (confidence 0.5–0.8)
| # | 标题 | 来源 | 时间 | 热度信号 | 置信度 |
|---|------|------|------|----------|--------|
| 4 | [Title](URL) | Source | Time | Evidence | 0.75 |

**快速跳转:**
- [Title](URL)

### 值得关注 (confidence 0.3–0.5)
| # | 标题 | 来源 | 时间 | 热度信号 | 置信度 |
|---|------|------|------|----------|--------|
| 7 | [Title](URL) | Source | Time | Evidence | 0.45 |

**快速跳转:**
- [Title](URL)

### 总结
<1-2 sentence synthesis of the overall picture>
```

**CRITICAL — Every hotspot title MUST be a clickable markdown link:**
```
[Title Text](https://full-url)
```

If the scraper returned a URL in the candidate's `url` field, use it as the link target. Never show a title as plain text when a URL is available.

For each hotspot entry in the table, always include these columns:
- **#** — rank number
- **标题** — clickable markdown link `[Title](URL)`
- **来源** — source platform name
- **时间** — relative time (e.g. "3天前") + absolute time when available
- **热度信号** — specific evidence (HN points/comments, publication tier, event significance)
- **置信度** — 0.0–1.0 score

At the end of each section (below the table), for users who prefer a compact link list, include:
```
**快速跳转:**
- [Title 1](url1)
- [Title 2](url2)
```

## Multi-keyword batch scanning

When the user wants to monitor multiple keywords, run the scraper once per keyword (sequentially, not in parallel, to avoid rate limiting). Then present a combined analysis.

```bash
for kw in "AI coding" "LLM agent" "GPT-5"; do
  node scripts/scout.js -q "$kw" -m 5 > "results_${kw// /_}.json"
done
```

## Tips

- **Rate limiting**: The scraper has built-in timeouts. Running many queries back-to-back may trigger CAPTCHAs on some sources. Space batch queries 2–3 seconds apart.
- **Source selection**: For Chinese topics, prefer `sogou,wechat,bilibili`. For tech topics, `hackernews,bing-news` is ideal. For general topics, use all sources.
- **Bilibili auth**: The scraper auto-refreshes Bilibili WBI credentials. If Bilibili returns 0 results, wait 60 seconds and retry.
- **Privacy**: All scraping happens client-side through your network. No data is sent to any third-party service.
- **The scraper runs locally** — no server process, no database writes, no persistent state.

## Limitations

- Twitter/X is not included (requires paid API key)
- Some sources may return CAPTCHA pages after heavy use
- Results reflect what's publicly indexed, not real-time firehose data
- Deep content analysis (reading full articles) is not performed — only titles and snippets are evaluated
