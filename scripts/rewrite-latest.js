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

const REWRITE_COUNT = 50; // 書き直す最大件数（解説カバー率向上のため引き上げ）

function isEnglish(text) {
  return !/[\u3040-\u9FFF]/.test(text);
}

function needsRewrite(content) {
  // 解説3セクション（【要約】【日本への影響】【注目点】）が揃っていなければ書き直し対象
  return !(
    content.includes('\u3010\u8981\u7D04\u3011') &&
    content.includes('\u3010\u65E5\u672C\u3078\u306E\u5F71\u97FF\u3011') &&
    content.includes('\u3010\u6CE8\u76EE\u70B9\u3011')
  );
}

/** 不動産金融に無関係な記事をキーワードで除外 */
function isRelevantToRealEstateFinance(title, description, source) {
  const text = (title + ' ' + description + ' ' + source).toLowerCase();
  const EXCLUDE = /ゲーム|アニメ|芸能|スポーツ|ゴルフ|サッカー|野球|バスケ|料理|レシピ|ダイエット|美容|ファッション|音楽|映画|ドラマ|漫画|小説|占い|星座|グルメ|旅行ガイド|観光スポット|年頭所感|イメージキャラクター|新tvcm|tvcm|新cm|衣料循環|リサイクル衣料|ペット|犬|猫|結婚|婚活|恋愛|育児|子育て/i;
  if (EXCLUDE.test(text)) return false;
  const RELEVANT = /不動産|reit|リート|投資法人|投資信託|物件|オフィス|商業施設|物流施設|住宅|マンション|ビル|賃貸|売買|売却|取得|開発|建設|建築|金融|ファンド|利回り|cbre|proptech|プロップテック|不動産テック|テナント|賃料|地価|再開発|都市開発|鑑定|仲介|管理|アセット|ポートフォリオ|キャップレート|証券化|ローン|担保|エクイティ|デット|コワーキング|データセンター|倉庫|ホテル|旅館|シニア住宅|ヘルスケア施設|インフラ|再エネ/i;
  if (!RELEVANT.test(text)) return false;
  return true;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function generateRichContent(client, title, description, category, isEng) {
  const sourceNote = isEng
    ? `以下は英語の不動産ニュース記事です。日本語に翻訳したうえで執筆してください。\n\n英語タイトル: ${title}\n英語リード文: ${description}`
    : `以下の不動産ニュース記事について執筆してください。\n\nタイトル: ${title}\nリード文: ${description}`;

  const titleField = isEng ? '"title": "日本語タイトル（50文字以内・簡潔に）",' : '';

  const prompt = `あなたは不動産金融・PropTech専門の日本語アナリストです。
${sourceNote}

カテゴリ: ${category}

まず、この記事が「不動産金融」に関連するか判定してください。
不動産金融とは：不動産投資、REIT、不動産ファンド、不動産証券化、不動産売買・取得・売却、不動産開発、商業不動産、不動産テクノロジー、不動産市場動向、不動産AI活用、物流施設・データセンター等の不動産アセットに関する内容です。

関連性が低い場合は: {"relevant": false}

関連性がある場合、以下の3セクション構成で記事本文を執筆してください:
- 【要約】: 記事の核心を2〜3文で簡潔に
- 【日本への影響】: 日本の不動産市場・業界に与える影響を独自の視点で具体的に2〜3文
- 【注目点】: 技術的またはビジネスモデルの特筆すべきポイントを2〜3文

JSONのみで返してください（コードブロック不要）:
{
  "relevant": true,
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

  // ── 事前フィルタ: キーワードベースで明らかに無関係な記事を除外 ──
  const preFilterRemoved = [];
  const filteredArticles = articles.filter(a => {
    // HORIE カテゴリは除外対象外
    if (a.category === 'HORIE') return true;
    // 既にリッチ解説がある記事はそのまま残す
    if (!needsRewrite(a.content)) return true;
    // キーワードフィルタ
    if (!isRelevantToRealEstateFinance(a.title, a.description, a.source)) {
      preFilterRemoved.push(a);
      return false;
    }
    return true;
  });

  if (preFilterRemoved.length > 0) {
    console.log(`事前フィルタで除外: ${preFilterRemoved.length} 件（不動産金融に無関係）`);
    preFilterRemoved.forEach(a => console.log(`  - [${a.category}] ${a.title.slice(0, 60)}`));
    console.log();
  }

  // publishedAt 降順でソートし、【】形式でないものを対象に
  const targets = [...filteredArticles]
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
    .filter(a => needsRewrite(a.content))
    .slice(0, REWRITE_COUNT);

  console.log(`書き直し対象: ${targets.length} 件（最新順・未リッチ化のもの）\n`);

  const targetIds = new Set(targets.map(a => a.id));
  const removeIds = new Set(); // Claude判定で無関係とされた記事
  let done = 0;

  for (const article of filteredArticles) {
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

      if (rich.relevant === false) {
        console.log('(無関係 → 除外)');
        removeIds.add(article.id);
        await sleep(350);
        continue;
      }

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

  // Claude判定で無関係とされた記事を除外
  const finalArticles = filteredArticles.filter(a => !removeIds.has(a.id));
  if (removeIds.size > 0) {
    console.log(`\nClaude判定で除外: ${removeIds.size} 件`);
  }

  // 書き直した配列を mockNews.ts に書き戻す
  const header = ts.slice(0, startIdx);
  const footer = ts.slice(endIdx);
  const newJson = JSON.stringify(finalArticles, null, 2)
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
  const totalRemoved = preFilterRemoved.length + removeIds.size;
  console.log(`\n✅ ${done - removeIds.size} 件を書き直し、${totalRemoved} 件の無関係記事を除外 → src/data/mockNews.ts 更新 (残り ${finalArticles.length} 件)`);
}

main().catch(e => {
  console.error('❌ エラー:', e.message);
  process.exit(1);
});
