// Excel → mockNews.ts 変換スクリプト
// 使い方: node scripts/convert-excel.js

const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// カテゴリ画像マッピング（Unsplash）
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const CATEGORY_IMAGES = {
  'CBRE':    [
    'https://images.unsplash.com/photo-1486325212027-8081e485255e?w=800&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1464938050520-ef2270bb8ce8?w=800&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1555636222-cae831e670b3?w=800&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?w=800&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1560518883-ce09059eeffa?w=800&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1497366216548-37526070297c?w=800&auto=format&fit=crop',
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

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// タイトルクリーニング
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function cleanTitle(raw) {
  if (!raw) return '';
  let title = String(raw);

  // 「改善点：」「**改善のポイント:**」以降を削除
  title = title.replace(/\n+改善点[：:].*/s, '').trim();
  title = title.replace(/\n+\*\*改善.*$/s, '').trim();
  title = title.replace(/\n+改善のポイント.*$/s, '').trim();

  // 「改善版:」「改善版：」で始まる場合、**太字** 部分を抽出
  if (/^改善版[：:]/.test(title) || title.startsWith('【CBRE】改善版')) {
    const boldMatch = title.match(/\*\*(.+?)\*\*/);
    if (boldMatch) {
      // 【CBRE】などのプレフィックスを保持
      const prefix = title.match(/^(【[^\]]+】\s*)/)?.[1] || '';
      return (prefix + boldMatch[1]).trim();
    }
    // 太字がなければ改善版: 以降の最初の行を使う
    const afterKaizen = title.replace(/^.*?改善版[：:]\s*\n*/, '').trim();
    const firstLine = afterKaizen.split('\n')[0].trim();
    if (firstLine) return firstLine;
  }

  // - source 形式のサフィックスを削除（「- Bloomberg」など）
  title = title.replace(/\s+-\s+[\w\s.&]+$/, '').trim();

  // 末尾の改行を削除
  return title.trim();
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 【要約】セクション抽出
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function extractDescription(analysis) {
  if (!analysis) return '';
  const match = String(analysis).match(/【要約】[：:]\s*([\s\S]+?)(?=\n\n【|$)/);
  if (match) return match[1].trim();
  // フォールバック：最初の段落
  return String(analysis).split('\n\n')[0].replace(/【[^】]+】[：:]?\s*/g, '').trim().substring(0, 200);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// キーワード → カテゴリ マッピング
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function mapCategory(keyword) {
  if (!keyword) return '市場動向';
  const kw = String(keyword).toLowerCase();
  if (kw.includes('cbre')) return 'CBRE';
  if (kw.includes('proptech') || kw.includes('不動産テック')) return 'PropTech';
  if (kw.includes('commercial') || kw.includes('商業')) return '商業不動産';
  if (kw.includes('ai') || kw.includes('人工知能') || kw.includes('technology') || kw.includes('tech')) return 'AI・テック';
  if (kw.includes('automation') || kw.includes('自動')) return '市場動向';
  return '市場動向';
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 画像選択（カテゴリごとにローテーション）
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function pickImage(category) {
  if (!imageCounts[category]) imageCounts[category] = 0;
  const images = CATEGORY_IMAGES[category] || CATEGORY_IMAGES['市場動向'];
  const img = images[imageCounts[category] % images.length];
  imageCounts[category]++;
  return img;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 読了時間を本文の長さから推定（平均400字/分）
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function calcReadTime(text) {
  const len = String(text || '').length;
  return Math.max(1, Math.round(len / 400));
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 日付を ISO 8601 に変換
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function parseDate(raw) {
  if (!raw) return new Date().toISOString();
  try {
    return new Date(String(raw)).toISOString();
  } catch {
    return new Date().toISOString();
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// メイン処理
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const EXCEL_PATH = path.join(__dirname, '..', '不動産AIニュース.xlsx');
const OUT_PATH   = path.join(__dirname, '..', 'src', 'data', 'mockNews.ts');

const wb = XLSX.readFile(EXCEL_PATH);
const ws = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });

// 1行目がヘッダー
const dataRows = rows.slice(1).filter(r => r[1]); // タイトルがある行のみ

const articles = dataRows.map((row, i) => {
  // 列マッピング: 取得日時[0], タイトル[1], 分析[2], 重要度[3], 情報源[4], 公開日[5], URL[6], キーワード[7]
  const rawTitle   = row[1];
  const analysis   = row[2] || '';
  const source     = row[4] || '不明';
  const pubDate    = row[5];
  const url        = row[6] || '';
  const keyword    = row[7] || '';

  const title       = cleanTitle(rawTitle);
  const category    = mapCategory(keyword);
  const description = extractDescription(analysis);
  const content     = String(analysis).trim();
  const publishedAt = parseDate(pubDate);
  const imageUrl    = pickImage(category);
  const readTime    = calcReadTime(content);

  return {
    id:          String(i + 1),
    title,
    description,
    content,
    category,
    author:      source,  // 著者情報がないので情報源を使用
    publishedAt,
    imageUrl,
    source,
    url,
    readTime,
  };
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TypeScript ファイル生成
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const tsContent = `import { Article } from '@/types/news';

export const mockArticles: Article[] = ${JSON.stringify(articles, null, 2)};

export const categories = ['トップ', 'CBRE', 'AI・テック', 'PropTech', '商業不動産', '市場動向'] as const;
`;

fs.writeFileSync(OUT_PATH, tsContent, 'utf8');
console.log(`✅ ${articles.length}件の記事を生成しました → ${OUT_PATH}`);
articles.forEach((a, i) => console.log(`  [${i+1}] [${a.category}] ${a.title.substring(0, 50)}`));
