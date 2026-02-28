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
 * Claude API で記事を日本語リッチコンテンツに変換（英語は翻訳も）
 * content は【要約】【日本への影響】【注目点】の3セクション構成
 * @param {string} title
 * @param {string} description
 * @param {string} category
 * @param {boolean} isEng - 英語記事の場合 true（タイトルも翻訳する）
 * @returns {{ title?, description, content } | null}
 */
async function generateRichContent(title, description, category, isEng = false) {
  const client = getAnthropicClient();
  if (!client) return null;

  try {
    const sourceNote = isEng
      ? `以下は英語の不動産ニュース記事です。日本語に翻訳したうえで執筆してください。\n\n英語タイトル: ${title}\n英語リード文: ${description}`
      : `以下の不動産ニュース記事について執筆してください。\n\nタイトル: ${title}\nリード文: ${description}`;

    const titleField = isEng
      ? '"title": "日本語タイトル（50文字以内・簡潔に）",'
      : '';

    const prompt = `あなたは不動産・PropTech専門の日本語アナリストです。
${sourceNote}

カテゴリ: ${category}

以下の3セクション構成で記事本文を執筆してください:
- 【要約】: 記事の核心を2〜3文で簡潔に
- 【日本への影響】: 日本の不動産市場・業界に与える影響を独自の視点で具体的に2〜3文
- 【注目点】: 技術的またはビジネスモデルの特筆すべきポイントを2〜3文

JSONのみで返してください（コードブロック不要）:
{
  ${titleField}
  "description": "記事の核心を1〜2文で（120文字以内）",
  "content": "【要約】: （ここにテキスト）。\\n\\n【日本への影響】: （ここにテキスト）。\\n\\n【注目点】: （ここにテキスト）。"
}`;

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content[0].text.trim()
      .replace(/^```json\s*/i, '').replace(/\s*```$/, '');
    const parsed = JSON.parse(text);

    if (!parsed.description || !parsed.content) {
      throw new Error('必須フィールドがありません');
    }
    return parsed;
  } catch (e) {
    console.warn(`  ⚠️  生成失敗 ("${title.slice(0, 30)}..."): ${e.message}`);
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
  // 1回の実行でClaudeを呼ぶ最大件数（コスト・速度制限）
  const MAX_CLAUDE_CALLS = 20;
  let claudeCalls = 0;

  console.log(`既存記事数: ${existingIds.length} 件`);
  console.log(`コンテンツ生成: ${hasTranslation ? `✅ ON (最大${MAX_CLAUDE_CALLS}件をリッチ化)` : '⚠️  OFF (ANTHROPIC_API_KEY なし)'}`);
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

        // Claude でリッチコンテンツ生成（英語は翻訳、日本語もセクション化）
        const isEng = isEnglish(title);
        if (hasTranslation && claudeCalls < MAX_CLAUDE_CALLS) {
          process.stdout.write('\n    ✍️  生成中: ' + title.slice(0, 45) + '... ');
          const rich = await generateRichContent(title, item.description || item.title, category, isEng);
          if (rich) {
            if (isEng && rich.title) title = rich.title;
            description = rich.description.slice(0, 120);
            content     = rich.content;
            claudeCalls++;
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
