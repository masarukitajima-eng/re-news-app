// 不動産ニュース自動取得スクリプト
// 使い方: node scripts/fetch-news.js
//
// Google News RSS から最新の不動産・AI系ニュースを取得して
// 既存の Excel と同じ列形式で保存します。
// 列: 取得日時 | タイトル | 分析 | 重要度 | 情報源 | 公開日 | URL | キーワード

const XLSX = require('xlsx');
const path = require('path');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 検索クエリ設定（キーワード → カテゴリ）
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const QUERIES = [
  { keyword: '不動産 AI',         category: 'AI・テック'  },
  { keyword: '不動産テック',       category: 'PropTech'    },
  { keyword: 'PropTech',          category: 'PropTech'    },
  { keyword: 'CBRE 不動産',       category: 'CBRE'        },
  { keyword: '商業不動産',         category: '商業不動産'  },
  { keyword: '不動産 市場動向',    category: '市場動向'    },
  { keyword: '不動産 人工知能',    category: 'AI・テック'  },
];

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Google News RSS URL 生成
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function rssUrl(query) {
  return `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=ja&gl=JP&ceid=JP:ja`;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// XML ユーティリティ（依存パッケージ不要）
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function extractTag(xml, tag) {
  // CDATA と通常テキスト両対応
  const re = new RegExp(
    `<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>|<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`,
    'i'
  );
  const m = xml.match(re);
  return m ? (m[1] ?? m[2] ?? '').trim() : '';
}

function extractAttr(xml, tag, attr) {
  const m = xml.match(new RegExp(`<${tag}[^>]*\\s${attr}="([^"]*)"`, 'i'));
  return m ? m[1] : '';
}

function decodeHtml(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/<[^>]+>/g, '') // HTML タグを除去
    .trim();
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// RSS XML パーサー
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function parseRssItems(xml) {
  const items = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const block = m[1];

    // Google News の <link> はテキストノードではなく <link>URL</link> 形式
    let link = extractTag(block, 'link');
    // フォールバック：<guid> を URL として使う
    if (!link || link.startsWith('http') === false) {
      link = extractTag(block, 'guid') || link;
    }

    const sourceName = extractTag(block, 'source') || extractHostname(link);
    const sourceUrl  = extractAttr(block, 'source', 'url') || link;

    items.push({
      title:       decodeHtml(extractTag(block, 'title')),
      link:        link.trim(),
      pubDate:     extractTag(block, 'pubDate'),
      source:      decodeHtml(sourceName) || sourceUrl,
      description: decodeHtml(extractTag(block, 'description')),
    });
  }
  return items.filter(i => i.title && i.link);
}

function extractHostname(url) {
  try { return new URL(url).hostname.replace('www.', ''); }
  catch { return ''; }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// RSS フェッチ
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function fetchRss(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; RealEstateNewsBot/1.0)',
      'Accept': 'application/rss+xml, application/xml, text/xml',
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// メイン処理
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function main() {
  const fetchedAt = new Date().toISOString();
  const rows = [
    // 既存 Excel と同じヘッダー
    ['取得日時', 'タイトル', '分析', '重要度', '情報源', '公開日', 'URL', 'キーワード'],
  ];
  const seenUrls = new Set();

  for (const { keyword, category } of QUERIES) {
    const url = rssUrl(keyword);
    process.stdout.write(`📡 [${category}] "${keyword}" ... `);

    let items = [];
    try {
      const xml = await fetchRss(url);
      items = parseRssItems(xml);
      console.log(`${items.length} 件`);
    } catch (e) {
      console.log(`✗ エラー: ${e.message}`);
      await sleep(500);
      continue;
    }

    for (const item of items) {
      if (!item.link || seenUrls.has(item.link)) continue;
      seenUrls.add(item.link);

      rows.push([
        fetchedAt,        // 取得日時
        item.title,       // タイトル
        item.description, // 分析（RSS の description をそのまま格納）
        '',               // 重要度（手動 or AI で後から付与）
        item.source,      // 情報源
        item.pubDate,     // 公開日
        item.link,        // URL
        keyword,          // キーワード
      ]);
    }

    await sleep(600); // レートリミット対策
  }

  // ━━━━ Excel 出力 ━━━━
  const ws = XLSX.utils.aoa_to_sheet(rows);

  // 列幅を設定（見やすさのため）
  ws['!cols'] = [
    { wch: 22 }, // 取得日時
    { wch: 60 }, // タイトル
    { wch: 80 }, // 分析
    { wch: 8  }, // 重要度
    { wch: 20 }, // 情報源
    { wch: 30 }, // 公開日
    { wch: 80 }, // URL
    { wch: 20 }, // キーワード
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'ニュース');

  const dateStr = new Date().toISOString().slice(0, 10);
  const outPath = path.join(__dirname, '..', `不動産AIニュース_${dateStr}.xlsx`);
  XLSX.writeFile(wb, outPath);

  const total = rows.length - 1; // ヘッダー除く
  console.log(`\n✅ ${total} 件を保存しました`);
  console.log(`   → ${outPath}`);
  console.log('\n次のステップ:');
  console.log('  node scripts/convert-excel.js  # Excel → mockNews.ts に変換');
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

main().catch(e => {
  console.error('❌ 失敗:', e.message);
  process.exit(1);
});
