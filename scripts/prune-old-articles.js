/**
 * 90日以上経過した記事を src/data/mockNews.ts から削除するスクリプト
 * 使い方: node scripts/prune-old-articles.js
 * 他スクリプトから: const { pruneOldArticles } = require('./prune-old-articles')
 */

const fs   = require('fs');
const path = require('path');

const PRUNE_DAYS = 90;

/**
 * mockNews.ts のテキストから publishedAt が PRUNE_DAYS 日以上前の記事を削除する。
 * "= [" の位置から配列を特定し JSON としてパース → 再シリアライズ。
 */
function pruneOldArticles(ts) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - PRUNE_DAYS);

  // "= [" の位置から配列開始を特定（型定義の "Article[]" を誤検出しないため）
  const assignIdx  = ts.indexOf('= [');
  const arrayStart = assignIdx === -1 ? -1 : assignIdx + 2; // "= [" の "[" 位置
  const arrayEnd   = ts.lastIndexOf('];');
  if (arrayStart === -1 || arrayEnd === -1) {
    console.warn('  ⚠️  配列が見つかりません');
    return { ts, removed: 0, kept: 0 };
  }

  // [ ... ] を抽出して JSON としてパース（末尾の trailing comma を除去）
  const jsonStr = ts
    .slice(arrayStart, arrayEnd + 1)
    .replace(/,(\s*\])$/, '$1');

  let articles;
  try {
    articles = JSON.parse(jsonStr);
  } catch (e) {
    console.warn('  ⚠️  JSON パース失敗:', e.message.slice(0, 80));
    return { ts, removed: 0, kept: 0 };
  }

  const before = articles.length;
  const kept   = articles.filter(a => {
    if (!a.publishedAt) return true;
    return new Date(a.publishedAt) >= cutoff;
  });
  const removed = before - kept.length;

  if (removed === 0) {
    return { ts, removed: 0, kept: before };
  }

  // TypeScript ファイルを再構築
  const prefix  = ts.slice(0, arrayStart);
  const suffix  = ts.slice(arrayEnd + 1);
  const newBody = kept
    .map(a => '  ' + JSON.stringify(a, null, 2).replace(/\n/g, '\n  '))
    .join(',\n');

  const newTs = prefix + '[\n' + newBody + ',\n]' + suffix;
  return { ts: newTs, removed, kept: kept.length };
}

// ── スタンドアロン実行時のみ動作 ────────────────────────────
if (require.main === module) {
  const mockPath = path.join(__dirname, '..', 'src', 'data', 'mockNews.ts');
  let ts = fs.readFileSync(mockPath, 'utf8');

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - PRUNE_DAYS);

  const totalBefore = (ts.match(/"id": "/g) || []).length;
  console.log(`基準日: ${cutoff.toISOString().slice(0, 10)} (${PRUNE_DAYS}日前)`);
  console.log(`処理前: ${totalBefore} 件`);

  const { ts: pruned, removed, kept } = pruneOldArticles(ts);

  if (removed === 0) {
    console.log('✅ 削除対象なし（全記事が90日以内）');
  } else {
    fs.writeFileSync(mockPath, pruned, 'utf8');
    console.log(`✅ 削除: ${removed} 件 / 残り: ${kept} 件`);
    fs.writeFileSync(path.join(__dirname, '..', '.news-updated'), 'pruned');
  }
}

module.exports = { pruneOldArticles, PRUNE_DAYS };
