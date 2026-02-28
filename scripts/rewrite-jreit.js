// 既存 JREIT 記事を【取得/売却】物件名（価格）形式に一括リライトするスクリプト
// 使い方: ANTHROPIC_API_KEY=xxx node scripts/rewrite-jreit.js

const fs   = require('fs');
const path = require('path');

// .env.local 読み込み
function loadEnvLocal() {
  const envPath = path.join(__dirname, '..', '.env.local');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const m = line.match(/^([^#=\s][^=]*)=(.*)$/);
    if (m && !process.env[m[1].trim()]) process.env[m[1].trim()] = m[2].trim();
  }
}
loadEnvLocal();

const { Anthropic } = require('@anthropic-ai/sdk');

const REWRITE_COUNT = 50; // 最新50件のJREIT記事を対象

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/** 物件取得・売却に関する記事かどうか判定 */
function isJREITTransaction(title) {
  const transactionWords = /取得|売却|譲渡|購入|取得決定|売却決定|取得価格|売却価格|物件取得|物件売却|不動産取得|資産取得|資産売却/;
  const excludeWords = /指数|ETF|市況|レポート|見通し|分析|ランキング|利回り平均|概況|決算|増配|減配|資金調達|起債|投資口|公募|募集|上場|格付け/;
  return transactionWords.test(title) && !excludeWords.test(title);
}

/** タイトルがすでに【取得/売却】形式かチェック */
function alreadyFormatted(title) {
  return /^【(取得|売却|譲渡)】/.test(title);
}

async function rewriteJREIT(client, title, description, content) {
  const prompt = `あなたは不動産・J-REIT専門の日本語アナリストです。

以下のJ-REIT物件売買記事を刷新してください。

元タイトル: ${title}
元リード文: ${description}
元本文: ${content.slice(0, 500)}

## タイトル形式（必須）
「【取得】物件名（価格億円）」または「【売却】物件名（価格億円）」の形式にしてください。
- 取得・売却どちらか明確でない場合は文脈から判断
- 価格が不明な場合は「（価格未開示）」
- 例: 「【取得】ハイアット リージェンシー 東京（1,260億円）」
- 例: 「【売却】プロメナ神戸（価格未開示）」

## 本文3セクション構成
- 【要約】: 物件名・取得価格・利回りを含む取引概要を2〜3文で
- 【日本への影響】: この取引がJ-REIT市場・投資家・不動産市況に与える影響を2〜3文
- 【注目点】: 物件の特徴・立地・取得先・投資戦略上の意義を2〜3文

## 必須記載事項（不明な場合は「未開示」と記載）
- 物件名（正式名称）
- 取得価格または売却価格（億円）
- 期待利回り（%）
- 取得先・売却先

JSONのみで返してください（コードブロック不要）:
{
  "title": "【取得/売却】形式のタイトル",
  "description": "記事の核心を1〜2文で（120文字以内）",
  "content": "【要約】: （テキスト）。\\n\\n【日本への影響】: （テキスト）。\\n\\n【注目点】: （テキスト）。"
}`;

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1200,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0].text.trim()
    .replace(/^```json\s*/i, '').replace(/\s*```$/, '');
  return JSON.parse(text);
}

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('❌ ANTHROPIC_API_KEY が設定されていません');
    process.exit(1);
  }

  const client = new Anthropic({ apiKey });
  const mockPath = path.join(__dirname, '..', 'src', 'data', 'mockNews.ts');
  let ts = fs.readFileSync(mockPath, 'utf8');

  // 配列部分を抽出してパース
  const startMarker = 'export const mockArticles: Article[] = [';
  const startIdx = ts.indexOf(startMarker) + startMarker.length - 1;
  const endIdx = ts.lastIndexOf('];') + 1;

  let articles;
  try {
    const jsonStr = ts.slice(startIdx, endIdx).replace(/,(\s*)\]$/, '$1]');
    articles = JSON.parse(jsonStr);
  } catch (e) {
    console.error('❌ mockNews.ts のパースに失敗:', e.message);
    process.exit(1);
  }

  const jreitArticles = articles.filter(a => a.category === 'JREIT');
  console.log(`JREIT記事総数: ${jreitArticles.length} 件`);

  // 物件取引記事のみ・未フォーマットのものを対象（最新順）
  const targets = [...jreitArticles]
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
    .filter(a => isJREITTransaction(a.title) && !alreadyFormatted(a.title))
    .slice(0, REWRITE_COUNT);

  console.log(`リライト対象: ${targets.length} 件（未フォーマット・物件取引のみ）\n`);

  if (targets.length === 0) {
    console.log('✅ 全件フォーマット済みです');
    return;
  }

  const targetIds = new Set(targets.map(a => a.id));
  let done = 0;

  for (const article of articles) {
    if (!targetIds.has(article.id)) continue;

    process.stdout.write(`[${++done}/${targets.length}] ID:${article.id} "${article.title.slice(0, 40)}..." → `);

    try {
      const rich = await rewriteJREIT(
        client,
        article.title,
        article.description,
        article.content,
      );

      if (rich.title) article.title = rich.title;
      article.description = (rich.description || article.description).slice(0, 120);
      article.content     = rich.content;
      article.readTime    = Math.max(1, Math.round(article.content.length / 400));

      console.log('✅ ' + article.title.slice(0, 50));
    } catch (e) {
      console.log(`⚠️  スキップ (${e.message})`);
    }

    await sleep(300);
  }

  // 書き戻し
  const header = ts.slice(0, startIdx);
  const footer = ts.slice(endIdx);
  const newJson = JSON.stringify(articles, null, 2);

  fs.writeFileSync(mockPath, header + newJson + footer, 'utf8');
  console.log(`\n✅ ${done} 件をリライトしました → src/data/mockNews.ts 更新`);
}

main().catch(e => {
  console.error('❌ エラー:', e.message);
  process.exit(1);
});
