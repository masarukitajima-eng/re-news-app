// 不動産ニュース自動取得・更新スクリプト
// GitHub Actions / ローカル両対応・APIキー不要（翻訳はオプション）
// 英語記事は Claude API で日本語に翻訳して保存
//
// 使い方: node scripts/fetch-and-update.js

const fs   = require('fs');
const path = require('path');

// ── .env.local の読み込み ─────────────────────────────
function loadEnvLocal() {
  const envPath = path.join(__dirname, '..', '.env.local');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const m = line.match(/^([^#=\s][^=]*)=(.*)$/);
    if (m && !process.env[m[1].trim()]) {
      process.env[m[1].trim()] = m[2].trim();
    }
  }
}
loadEnvLocal();

// ──────────────────────────────────────────
// 検索クエリ設定
// ──────────────────────────────────────────
const QUERIES = [
  { keyword: '不動産 AI',         category: 'AI・テック'  },
  { keyword: '不動産テック',       category: 'PropTech'    },
  { keyword: 'PropTech',          category: 'PropTech'    },
  { keyword: 'CBRE 不動産',       category: 'CBRE'        },
  { keyword: '商業不動産',         category: '商業不動産'  },
  { keyword: '不動産 市場動向',    category: '市場動向'    },
  { keyword: '不動産 人工知能',    category: 'AI・テック'  },
];

const CATEGORY_IMAGES = {
  'CBRE': [
    'https://images.unsplash.com/photo-1486325212027-8081e485255e?w=800&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1464938050520-ef2270bb8ce8?w=800&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1560518883-ce09059eeffa?w=800&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?w=800&auto=format&fit=crop',
  ],
  'AI・テック': [
    'https://images.unsplash.com/photo-1677442135703-1787eea5ce01?w=800&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1620712943543-bcc4688e7485?w=800&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1485827404703-89b55fcc595e?w=800&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1518186285589-2f7649de83e0?w=800&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1531297484001-80022131f5a1?w=800&auto=format&fit=crop',
  ],
  'PropTech': [
    'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=800&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1504307651254-35680f356dfd?w=800&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=800&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1449824913935-59a10b8d2000?w=800&auto=format&fit=crop',
  ],
  '商業不動産': [
    'https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=800&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1470219556762-1771e7f9427d?w=800&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1582407947304-fd86f028f716?w=800&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1497366811353-6870744d04b2?w=800&auto=format&fit=crop',
  ],
  '市場動向': [
    'https://images.unsplash.com/photo-1642790551116-18e4f77d7a66?w=800&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=800&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1535320903710-d993d3d77d29?w=800&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=800&auto=format&fit=crop',
  ],
};

const imageCounts = {};

// ──────────────────────────────────────────
// XML ユーティリティ（依存パッケージ不要）
// ──────────────────────────────────────────
function extractTag(xml, tag) {
  const re = new RegExp(
    `<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>|<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`,
    'i',
  );
  const m = xml.match(re);
  return m ? (m[1] ?? m[2] ?? '').trim() : '';
}

function decodeHtml(str) {
  return str
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/<[^>]+>/g, '').trim();
}

function extractHostname(url) {
  try { return new URL(url).hostname.replace('www.', ''); } catch { return ''; }
}

function parseRssItems(xml) {
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

async function fetchRss(query) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=ja&gl=JP&ceid=JP:ja`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/rss+xml' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

function pickImage(category) {
  const imgs = CATEGORY_IMAGES[category] || CATEGORY_IMAGES['市場動向'];
  const count = imageCounts[category] ?? 0;
  imageCounts[category] = count + 1;
  return imgs[count % imgs.length];
}

function calcReadTime(text) {
  return Math.max(1, Math.round(String(text || '').length / 400));
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ──────────────────────────────────────────
// 言語判定・翻訳
// ──────────────────────────────────────────

/** 日本語文字（ひらがな・カタカナ・漢字）が含まれていなければ英語と判定 */
function isEnglish(text) {
  return !/[\u3040-\u9FFF]/.test(text);
}

let anthropicClient = null;

function getAnthropicClient() {
  if (anthropicClient) return anthropicClient;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  try {
    const { Anthropic } = require('@anthropic-ai/sdk');
    anthropicClient = new Anthropic({ apiKey });
    return anthropicClient;
  } catch (e) {
    console.warn('  ⚠️  @anthropic-ai/sdk が見つかりません:', e.message);
    return null;
  }
}

/**
 * Claude API を使って英語記事を日本語に翻訳
 * @returns {{ title, description, content } | null}
 */
async function translateToJapanese(title, description, category) {
  const client = getAnthropicClient();
  if (!client) return null;

  try {
    const prompt = `あなたは不動産・PropTech専門の日本語ライターです。
以下の英語の不動産ニュース記事を日本語に翻訳・要約してください。

カテゴリ: ${category}
タイトル: ${title}
リード文: ${description}

以下のJSON形式のみで返してください（コードブロック不要）:
{
  "title": "日本語タイトル（簡潔に、50文字以内）",
  "description": "日本語のリード文（記事の要点を120文字以内で）",
  "content": "日本語の本文（300文字程度で詳しく解説）"
}`;

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 800,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content[0].text.trim()
      .replace(/^```json\s*/i, '').replace(/\s*```$/, '');
    const parsed = JSON.parse(text);

    // 必須フィールドの確認
    if (!parsed.title || !parsed.description || !parsed.content) {
      throw new Error('翻訳結果に必須フィールドがありません');
    }
    return parsed;
  } catch (e) {
    console.warn(`  ⚠️  翻訳失敗 ("${title.slice(0, 30)}..."): ${e.message}`);
    return null;
  }
}

// ──────────────────────────────────────────
// メイン処理
// ──────────────────────────────────────────
async function main() {
  const mockPath = path.join(__dirname, '..', 'src', 'data', 'mockNews.ts');
  let ts = fs.readFileSync(mockPath, 'utf8');

  // 既存 URL と ID を抽出
  const existingUrls = new Set([...ts.matchAll(/"url": "([^"]+)"/g)].map(m => m[1]));
  const existingIds  = [...ts.matchAll(/"id": "(\d+)"/g)].map(m => parseInt(m[1]));
  let nextId = existingIds.length > 0 ? Math.max(...existingIds) + 1 : 100;

  const hasTranslation = !!process.env.ANTHROPIC_API_KEY;
  console.log(`既存記事数: ${existingIds.length} 件`);
  console.log(`翻訳機能: ${hasTranslation ? '✅ ON (ANTHROPIC_API_KEY あり)' : '⚠️  OFF (ANTHROPIC_API_KEY なし)'}`);
  console.log('📡 Google News RSS を取得中...\n');

  const newArticles = [];
  const seenUrls    = new Set(existingUrls);

  for (const { keyword, category } of QUERIES) {
    process.stdout.write(`  [${category}] "${keyword}" ... `);
    try {
      const xml   = await fetchRss(keyword);
      const items = parseRssItems(xml);
      let added   = 0;

      for (const item of items) {
        if (seenUrls.has(item.link)) continue;
        seenUrls.add(item.link);

        const publishedAt = item.pubDate
          ? new Date(item.pubDate).toISOString()
          : new Date().toISOString();

        let title       = item.title;
        let description = (item.description || item.title).slice(0, 120);
        let content     = item.description || item.title;

        // 英語記事を翻訳
        if (isEnglish(title) && hasTranslation) {
          process.stdout.write('\n    🔄 翻訳中: ' + title.slice(0, 50) + '... ');
          const translated = await translateToJapanese(title, item.description || item.title, category);
          if (translated) {
            title       = translated.title;
            description = translated.description.slice(0, 120);
            content     = translated.content;
            process.stdout.write('✅\n');
          } else {
            process.stdout.write('(スキップ)\n');
          }
          await sleep(300); // レートリミット対策
        }

        newArticles.push({
          id:          String(nextId++),
          title,
          description,
          content,
          category,
          author:      item.source,
          publishedAt,
          imageUrl:    pickImage(category),
          source:      item.source,
          url:         item.link,
          readTime:    calcReadTime(content),
        });
        added++;
      }
      console.log(`取得 ${items.length} 件 / 新規 ${added} 件`);
    } catch (e) {
      console.log(`✗ ${e.message}`);
    }
    await sleep(500);
  }

  if (newArticles.length === 0) {
    console.log('\n✅ 新しい記事はありませんでした（スキップ）');
    return;
  }

  // mockNews.ts の末尾 ]; の直前に追記
  const insertPoint = ts.lastIndexOf('];');
  const newEntries  = newArticles
    .map(a => '  ' + JSON.stringify(a, null, 2).replace(/\n/g, '\n  '))
    .join(',\n');
  ts = ts.slice(0, insertPoint) + newEntries + ',\n' + ts.slice(insertPoint);
  fs.writeFileSync(mockPath, ts, 'utf8');

  const totalCount = [...ts.matchAll(/"id": "(\d+)"/g)].length;
  console.log(`\n✅ ${newArticles.length} 件追加 → 合計 ${totalCount} 件`);

  // CI 向け: 変更があったことを示すファイルを出力
  fs.writeFileSync(
    path.join(__dirname, '..', '.news-updated'),
    String(newArticles.length),
  );
}

main().catch(e => {
  console.error('❌ エラー:', e.message);
  process.exit(1);
});
