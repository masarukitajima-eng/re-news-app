// 最新記事をリッチ形式（【要約】【日本への影響】【注目点】）で書き直すスクリプト
// 使い方: ANTHROPIC_API_KEY=xxx node scripts/rewrite-latest.js

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

const REWRITE_COUNT = 20; // 書き直す最大件数

function isEnglish(text) {
  return !/[\u3040-\u9FFF]/.test(text);
}

function needsRewrite(content) {
  // 【】形式がなければ書き直し対象
  return !content.includes('【');
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function generateRichContent(client, title, description, category, isEng) {
  const sourceNote = isEng
    ? `以下は英語の不動産ニュース記事です。日本語に翻訳したうえで執筆してください。\n\n英語タイトル: ${title}\n英語リード文: ${description}`
    : `以下の不動産ニュース記事について執筆してください。\n\nタイトル: ${title}\nリード文: ${description}`;

  const titleField = isEng ? '"title": "日本語タイトル（50文字以内・簡潔に）",' : '';

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
  const startIdx = ts.indexOf(startMarker) + startMarker.length - 1; // '[' の位置
  const endIdx = ts.lastIndexOf('];') + 1; // ']' の位置

  let articles;
  try {
    // 末尾の trailing comma を除去してパース
    const jsonStr = ts.slice(startIdx, endIdx).replace(/,(\s*)\]$/, '$1]');
    articles = JSON.parse(jsonStr);
  } catch (e) {
    console.error('❌ mockNews.ts のパースに失敗:', e.message);
    process.exit(1);
  }

  console.log(`総記事数: ${articles.length} 件`);

  // publishedAt 降順でソートし、【】形式でないものを対象に
  const targets = [...articles]
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
    .filter(a => needsRewrite(a.content))
    .slice(0, REWRITE_COUNT);

  console.log(`書き直し対象: ${targets.length} 件（最新順・未リッチ化のもの）\n`);

  const targetIds = new Set(targets.map(a => a.id));
  let done = 0;

  for (const article of articles) {
    if (!targetIds.has(article.id)) continue;

    const isEng = isEnglish(article.title);
    process.stdout.write(`[${++done}/${targets.length}] ID:${article.id} "${article.title.slice(0, 40)}..." → `);

    try {
      const rich = await generateRichContent(
        client,
        article.title,
        article.description,
        article.category,
        isEng,
      );

      if (isEng && rich.title) article.title = rich.title;
      article.description = (rich.description || article.description).slice(0, 120);
      article.content     = rich.content;
      article.readTime    = Math.max(1, Math.round(article.content.length / 400));

      console.log('✅');
    } catch (e) {
      console.log(`⚠️  スキップ (${e.message})`);
    }

    await sleep(350);
  }

  // 書き直した配列を mockNews.ts に書き戻す
  const header = ts.slice(0, startIdx);
  const footer = ts.slice(endIdx);
  const newJson = JSON.stringify(articles, null, 2)
    .replace(/\n/g, '\n') // normalize
    // JSON.stringify の [ と ] を2スペースインデントに合わせる
    .split('\n')
    .map((line, i, arr) => {
      // 配列の最初と最後の [ ] はインデントなし
      if (i === 0 || i === arr.length - 1) return line;
      return line; // オブジェクト内は JSON.stringify がすでに適切にインデント
    })
    .join('\n');

  fs.writeFileSync(mockPath, header + newJson + footer, 'utf8');
  console.log(`\n✅ ${done} 件を書き直しました → src/data/mockNews.ts 更新`);
}

main().catch(e => {
  console.error('❌ エラー:', e.message);
  process.exit(1);
});
