/**
 * 不動産ニュース リアルタイム取得 + Claude AI 分析スクリプト
 * 使い方: npx ts-node --project tsconfig.scripts.json scripts/fetch-realtime-news.ts
 *
 * 処理フロー:
 * 1. Google News RSS から最新ニュースを取得
 * 2. Claude Opus 4.6 が各記事を日本語で詳細分析
 * 3. Article 形式の JSON として保存（mockNews.ts にマージ可能）
 */

import Anthropic from '@anthropic-ai/sdk';
import * as fs from 'fs';
import * as path from 'path';

// .env.local を自動読み込み
const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim();
  }
}

// ──────────────────────────────────────────
// 型定義
// ──────────────────────────────────────────
type Category = 'CBRE' | 'AI・テック' | 'PropTech' | '商業不動産' | '市場動向';

interface Article {
  id: string;
  title: string;
  description: string;
  content: string;
  category: Category;
  author: string;
  publishedAt: string;
  imageUrl: string;
  source: string;
  url: string;
  readTime: number;
}

interface RssItem {
  title: string;
  link: string;
  pubDate: string;
  source: string;
  description: string;
  keyword: string;
  category: Category;
}

// ──────────────────────────────────────────
// 設定
// ──────────────────────────────────────────
const client = new Anthropic(); // ANTHROPIC_API_KEY 環境変数を自動参照

const QUERIES: { keyword: string; category: Category }[] = [
  { keyword: '不動産 AI',      category: 'AI・テック'  },
  { keyword: '不動産テック',    category: 'PropTech'    },
  { keyword: 'PropTech',       category: 'PropTech'    },
  { keyword: 'CBRE 不動産',    category: 'CBRE'        },
  { keyword: '商業不動産',      category: '商業不動産'  },
  { keyword: '不動産 市場動向', category: '市場動向'    },
];

const MAX_ARTICLES = 10; // Claude に送る記事数の上限（コスト管理）

const CATEGORY_IMAGES: Record<Category, string[]> = {
  'CBRE':    [
    'https://images.unsplash.com/photo-1486325212027-8081e485255e?w=800&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1560518883-ce09059eeffa?w=800&auto=format&fit=crop',
  ],
  'AI・テック': [
    'https://images.unsplash.com/photo-1677442135703-1787eea5ce01?w=800&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1620712943543-bcc4688e7485?w=800&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1485827404703-89b55fcc595e?w=800&auto=format&fit=crop',
  ],
  'PropTech': [
    'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=800&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=800&auto=format&fit=crop',
  ],
  '商業不動産': [
    'https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=800&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1497366811353-6870744d04b2?w=800&auto=format&fit=crop',
  ],
  '市場動向': [
    'https://images.unsplash.com/photo-1642790551116-18e4f77d7a66?w=800&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1535320903710-d993d3d77d29?w=800&auto=format&fit=crop',
  ],
};

const imageCounts: Partial<Record<Category, number>> = {};

// ──────────────────────────────────────────
// RSS ユーティリティ
// ──────────────────────────────────────────
function extractTag(xml: string, tag: string): string {
  const re = new RegExp(
    `<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>|<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`,
    'i',
  );
  const m = xml.match(re);
  return m ? (m[1] ?? m[2] ?? '').trim() : '';
}

function decodeHtml(str: string): string {
  return str
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/<[^>]+>/g, '').trim();
}

function extractHostname(url: string): string {
  try { return new URL(url).hostname.replace('www.', ''); } catch { return ''; }
}

function parseRssItems(xml: string): Omit<RssItem, 'keyword' | 'category'>[] {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)]
    .map(m => {
      const block = m[1];
      const link = (extractTag(block, 'link') || extractTag(block, 'guid')).trim();
      return {
        title:       decodeHtml(extractTag(block, 'title')),
        link,
        pubDate:     extractTag(block, 'pubDate'),
        source:      decodeHtml(extractTag(block, 'source')) || extractHostname(link),
        description: decodeHtml(extractTag(block, 'description')),
      };
    })
    .filter(i => i.title && i.link);
}

async function fetchRss(query: string): Promise<string> {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=ja&gl=JP&ceid=JP:ja`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/rss+xml' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

function pickImage(category: Category): string {
  const imgs = CATEGORY_IMAGES[category];
  const count = imageCounts[category] ?? 0;
  imageCounts[category] = count + 1;
  return imgs[count % imgs.length];
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

// ──────────────────────────────────────────
// Claude Opus 4.6 による記事分析
// ──────────────────────────────────────────
async function analyzeWithClaude(item: RssItem, id: string): Promise<Article> {
  const prompt = `あなたは不動産テック専門のアナリストです。以下のニュースを分析し、指定のJSON形式のみで回答してください。

【タイトル】${item.title}
【情報源】${item.source}
【RSS概要】${item.description || '（概要なし）'}
【キーワード】${item.keyword}
【カテゴリ】${item.category}

以下のJSONのみを出力してください（説明文・マークダウン不要）:
{
  "description": "（記事の要点を日本語80〜120文字で要約。体言止め推奨）",
  "content": "（日本語300〜500文字の詳細分析。業界への影響、日本市場との関連性、注目ポイントの3点を含めること）",
  "readTime": （1〜8の整数）
}`;

  const response = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 1024,
    thinking: { type: 'adaptive' },
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content
    .filter(b => b.type === 'text')
    .map(b => (b as { type: 'text'; text: string }).text)
    .join('');

  let parsed = {
    description: item.description.slice(0, 120) || item.title,
    content:     item.description || item.title,
    readTime:    2,
  };

  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) parsed = { ...parsed, ...JSON.parse(jsonMatch[0]) };
  } catch {
    // フォールバック: RSSの内容をそのまま使用
  }

  const publishedAt = item.pubDate
    ? new Date(item.pubDate).toISOString()
    : new Date().toISOString();

  return {
    id,
    title:       item.title,
    description: parsed.description,
    content:     parsed.content,
    category:    item.category,
    author:      item.source,
    publishedAt,
    imageUrl:    pickImage(item.category),
    source:      item.source,
    url:         item.link,
    readTime:    parsed.readTime,
  };
}

// ──────────────────────────────────────────
// メイン処理
// ──────────────────────────────────────────
async function main(): Promise<void> {
  console.log('📡 Google News RSS からニュースを取得中...\n');

  // ── RSS フェッチ ──
  const allItems: RssItem[] = [];
  const seenUrls = new Set<string>();

  for (const { keyword, category } of QUERIES) {
    try {
      const xml = await fetchRss(keyword);
      const items = parseRssItems(xml);
      let added = 0;
      for (const item of items) {
        if (!seenUrls.has(item.link)) {
          seenUrls.add(item.link);
          allItems.push({ ...item, keyword, category });
          added++;
        }
      }
      console.log(`  [${category}] "${keyword}" → ${added} 件`);
    } catch (e: unknown) {
      console.error(`  ✗ "${keyword}": ${(e as Error).message}`);
    }
    await sleep(500);
  }

  // 最新順ソート → 上限適用
  const targets = allItems
    .sort((a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime())
    .slice(0, MAX_ARTICLES);

  console.log(`\n🤖 Claude Opus 4.6 で上位 ${targets.length} 件を分析中...\n`);

  // ── 既存 mockNews.ts の最大 ID を取得 ──
  const mockPath = path.join(__dirname, '..', 'src', 'data', 'mockNews.ts');
  const existingTs = fs.readFileSync(mockPath, 'utf8');
  const existingIds = existingTs.match(/"id": "(\d+)"/g) ?? [];
  let nextId = existingIds.length > 0
    ? Math.max(...existingIds.map(s => parseInt(s.match(/\d+/)![0]))) + 1
    : 100;

  // ── Claude で分析 ──
  const articles: Article[] = [];

  for (let i = 0; i < targets.length; i++) {
    const item = targets[i];
    process.stdout.write(`  [${i + 1}/${targets.length}] ${item.title.slice(0, 45)}... `);
    try {
      const article = await analyzeWithClaude(item, String(nextId++));
      articles.push(article);
      console.log('✓');
    } catch (e: unknown) {
      console.log(`✗ ${(e as Error).message}`);
    }
    await sleep(300);
  }

  // ── JSON 保存 ──
  const dateStr = new Date().toISOString().slice(0, 10);
  const outPath = path.join(__dirname, '..', 'src', 'data', `fetchedNews_${dateStr}.json`);
  fs.writeFileSync(outPath, JSON.stringify(articles, null, 2), 'utf8');

  console.log(`\n✅ ${articles.length} 件の分析済み記事を保存しました`);
  console.log(`   → ${outPath}`);
  console.log('\n次のステップ:');
  console.log('  npm run update-news   # Excel 経由で更新');
  console.log('  # または手動で src/data/mockNews.ts にマージしてください');
}

main().catch(e => {
  console.error('\n❌ エラー:', e.message);
  process.exit(1);
});
