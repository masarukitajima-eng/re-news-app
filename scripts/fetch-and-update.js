// 不動産ニュース自動取得・更新スクリプト
// GitHub Actions / ローカル両対応・APIキー不要
// 使い方: node scripts/fetch-and-update.js
//
// Google News RSS → src/data/mockNews.ts に新記事を追記する

const fs   = require('fs');
const path = require('path');

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
// メイン処理
// ──────────────────────────────────────────
async function main() {
  const mockPath = path.join(__dirname, '..', 'src', 'data', 'mockNews.ts');
  let ts = fs.readFileSync(mockPath, 'utf8');

  // 既存 URL と ID を抽出
  const existingUrls = new Set([...ts.matchAll(/"url": "([^"]+)"/g)].map(m => m[1]));
  const existingIds  = [...ts.matchAll(/"id": "(\d+)"/g)].map(m => parseInt(m[1]));
  let nextId = existingIds.length > 0 ? Math.max(...existingIds) + 1 : 100;

  console.log(`既存記事数: ${existingIds.length} 件`);
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

        const description = (item.description || item.title).slice(0, 120);
        const content     = item.description || item.title;

        newArticles.push({
          id:          String(nextId++),
          title:       item.title,
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
    // 変更なしを示す終了コード 0 で終了
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
