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
// 検索クエリ設定（J-REITは日付フィルター付き・動的生成）
// ──────────────────────────────────────────

/** 直近 n 日前の日付を "YYYY-MM-DD" 形式で返す */
function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function buildQueries() {
  const d3 = daysAgo(3);   // 直近3日
  const d7 = daysAgo(7);   // 直近1週間

  return [
    // ── J-REIT 直近3日間（最優先・適時開示重視）────────────────────
    { keyword: `J-REIT 物件取得 after:${d3}`,             category: 'JREIT' },
    { keyword: `投資法人 取得決定 after:${d3}`,           category: 'JREIT' },
    { keyword: `J-REIT 売却 プレスリリース after:${d3}`,  category: 'JREIT' },
    { keyword: `リート 適時開示 不動産取得 after:${d3}`,  category: 'JREIT' },

    // ── 信頼ソース指定クエリ ─────────────────────────────────────
    { keyword: 'site:japan-reit.com 物件 取得 売却',                    category: 'JREIT' },
    { keyword: 'site:prtimes.jp 投資法人 物件取得 利回り',              category: 'JREIT' },
    { keyword: 'site:japan-reit.com',                                    category: 'JREIT' },

    // ── J-REIT 直近1週間（補完）──────────────────────────────────
    { keyword: `投資法人 取得 ホテル オフィス 物流 after:${d7}`,       category: 'JREIT' },
    { keyword: `REIT 不動産 取得 売却 利回り after:${d7}`,             category: 'JREIT' },
    { keyword: `ジャパン リート 物件取得 after:${d7}`,                 category: 'JREIT' },

    // ── 既存カテゴリ ─────────────────────────────────────────────
    { keyword: '不動産 AI',         category: 'AI・テック'  },
    { keyword: '不動産テック',       category: 'PropTech'    },
    { keyword: 'PropTech',          category: 'PropTech'    },
    { keyword: 'CBRE 不動産',       category: 'CBRE'        },
    { keyword: '商業不動産',         category: '商業不動産'  },
    { keyword: '不動産 市場動向',    category: '市場動向'    },
    { keyword: '不動産 人工知能',    category: 'AI・テック'  },
  ];
}

// J-REIT 信頼ソース（これらのドメインを優先的に処理）
const JREIT_PRIORITY_SOURCES = [
  'japan-reit.com',
  'prtimes.jp',
  'nikkei.com',
  'nfm.nikkeibp.co.jp',
  'ares.or.jp',
  'tse.or.jp',
];

const CATEGORY_IMAGES = {
  'JREIT': [
    'https://images.unsplash.com/photo-1486325212027-8081e485255e?w=800&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1464938050520-ef2270bb8ce8?w=800&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?w=800&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1582407947304-fd86f028f716?w=800&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1560518883-ce09059eeffa?w=800&auto=format&fit=crop',
  ],
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

/**
 * タイトル・ソースにJ-REIT関連ワードが含まれれば JREIT カテゴリと判定
 * 投資法人名（○○リート、○○投資法人）や適時開示キーワードを検出
 */
function detectJREIT(title, source = '') {
  const text = title + ' ' + source;
  return (
    // 投資法人・リート名の検出
    /投資法人|[^\s・、。（）()]+リート|J-?REIT|Jリート/.test(text) &&
    // 一般的な不動産AI/テック記事との混同を排除
    !/AIチャット|AI生成|スマートホーム|DX推進/.test(title)
  );
}

/**
 * JREIT記事が「具体的な物件取得・売却」を扱っているか判定
 * 市況レポート・指数・ファンド組成などは除外し、取引情報のみ通す
 */
function isJREITTransaction(title) {
  const transactionWords = /取得|売却|譲渡|購入|取得決定|売却決定|取得価格|売却価格|物件取得|物件売却|不動産取得|資産取得|資産売却/;
  const excludeWords = /指数|ETF|市況|レポート|見通し|分析|ランキング|利回り平均|概況|決算|増配|減配|資金調達|起債|投資口|公募|募集|上場|格付け/;
  return transactionWords.test(title) && !excludeWords.test(title);
}

/** J-REIT優先ソースかどうか判定 */
function isJREITPrioritySource(url) {
  return JREIT_PRIORITY_SOURCES.some(domain => url.includes(domain));
}

/**
 * 不動産金融に無関係な記事をキーワードベースで除外する事前フィルタ
 * Google News RSS は検索精度が低いため、取得後にフィルタリングが必要
 */
function isRelevantToRealEstateFinance(title, description, source) {
  const text = (title + ' ' + description + ' ' + source).toLowerCase();

  // 明確に無関係なトピックを除外
  const EXCLUDE_PATTERNS = /ゲーム|アニメ|芸能|スポーツ|ゴルフ|サッカー|野球|バスケ|料理|レシピ|ダイエット|美容|ファッション|音楽|映画|ドラマ|漫画|小説|占い|星座|グルメ|旅行ガイド|観光スポット|年頭所感|イメージキャラクター|新tvcm|tvcm|新cm|衣料循環|リサイクル衣料|ペット|犬|猫|結婚|婚活|恋愛|育児|子育て/i;
  if (EXCLUDE_PATTERNS.test(text)) return false;

  // 不動産金融に関連するキーワードが少なくとも1つ含まれていること
  const RELEVANT_PATTERNS = /不動産|reit|リート|投資法人|投資信託|物件|オフィス|商業施設|物流施設|住宅|マンション|ビル|賃貸|売買|売却|取得|開発|建設|建築|金融|ファンド|利回り|cbre|proptech|プロップテック|不動産テック|テナント|賃料|地価|再開発|都市開発|用途地域|容積率|鑑定|仲介|管理|アセット|ポートフォリオ|キャップレート|noi|デューデリ|証券化|spc|am会社|pm会社|信託受益権|ローン|担保|抵当|lender|borrower|エクイティ|デット|メザニン|バリュアション|コワーキング|データセンター|倉庫|ホテル|旅館|シニア住宅|ヘルスケア施設|インフラ|再エネ|太陽光|風力|蓄電/i;
  if (!RELEVANT_PATTERNS.test(text)) return false;

  return true;
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

    // JREIT は常にタイトルを生成（【取得/売却】形式に統一）、英語も同様
    const titleField = (isEng || category === 'JREIT')
      ? category === 'JREIT'
        ? '"title": "【取得】または【売却】で始まる物件名（価格）形式のタイトル（例：【取得】ハイアット リージェンシー 東京（1,260億円））",'
        : '"title": "日本語タイトル（50文字以内・簡潔に）",'
      : '';

    // J-REIT 専用の追加指示（取得価格・利回り・物件名・取得先を必須記載）
    const jreitNote = category === 'JREIT'
      ? `\nこれはJ-REIT（不動産投資信託）の具体的な物件取得・売却情報です。以下の要素を必ず本文に含めてください（不明な場合は「未開示」と記載）：\n  - 物件名（正式名称）\n  - 取得価格または売却価格（億円）\n  - 期待利回り（%）\n  - 取得先・売却先（前所有者または売却先）\n\nタイトルは必ず「【取得】物件名（価格億円）」または「【売却】物件名（価格億円）」の形式にしてください。価格不明の場合は「（価格未開示）」。`
      : '';

    // JREIT でも 要約・日本への影響・注目点 の標準3セクションに統一
    const sectionGuide = category === 'JREIT'
      ? `- 【要約】: 物件名・取得価格・利回りを含む取引概要を2〜3文で
- 【日本への影響】: この取引がJ-REIT市場・投資家・不動産市況に与える影響を2〜3文
- 【注目点】: 物件の特徴・立地・取得先・投資戦略上の意義を2〜3文`
      : `- 【要約】: 記事の核心を2〜3文で簡潔に
- 【日本への影響】: 日本の不動産市場・業界に与える影響を独自の視点で具体的に2〜3文
- 【注目点】: 技術的またはビジネスモデルの特筆すべきポイントを2〜3文`;

    const contentTemplate = `"content": "【要約】: （ここにテキスト）。\\n\\n【日本への影響】: （ここにテキスト）。\\n\\n【注目点】: （ここにテキスト）。"`;

    const prompt = `あなたは不動産金融・J-REIT専門の日本語アナリストです。
${sourceNote}
${jreitNote}

カテゴリ: ${category}

まず、この記事が「不動産金融」に関連するか判定してください。
不動産金融とは：不動産投資、REIT、不動産ファンド、不動産証券化、不動産売買・取得・売却、不動産開発、商業不動産、不動産テクノロジー、不動産市場動向、不動産AI活用、物流施設・データセンター等の不動産アセットに関する内容です。

関連性が低い場合（芸能、スポーツ、一般消費者向け広告、不動産と無関係な企業ニュース等）は以下を返してください:
{"relevant": false}

関連性がある場合、以下の3セクション構成で記事本文を執筆してください:
${sectionGuide}

JSONのみで返してください（コードブロック不要）:
{
  "relevant": true,
  ${titleField}
  "description": "記事の核心を1〜2文で（120文字以内）",
  ${contentTemplate}
}`;

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content[0].text.trim()
      .replace(/^```json\s*/i, '').replace(/\s*```$/, '');
    const parsed = JSON.parse(text);

    // 関連性が低いと判定された場合
    if (parsed.relevant === false) {
      return { relevant: false };
    }

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
// 90日超の記事を削除（prune-old-articles.js と共通ロジック）
// ──────────────────────────────────────────
const { pruneOldArticles } = require('./prune-old-articles');

// ──────────────────────────────────────────
// メイン処理
// ──────────────────────────────────────────
async function main() {
  const mockPath = path.join(__dirname, '..', 'src', 'data', 'mockNews.ts');
  let ts = fs.readFileSync(mockPath, 'utf8');

  // ── 90日超の古い記事を先に削除 ──────────────────────
  const { ts: pruned, removed: prunedCount } = pruneOldArticles(ts);
  if (prunedCount > 0) {
    console.log(`🗑  古い記事を削除: ${prunedCount} 件 (90日以上経過)`);
    ts = pruned;
  }

  // 既存 URL と ID を抽出
  const existingUrls = new Set([...ts.matchAll(/"url": "([^"]+)"/g)].map(m => m[1]));
  const existingIds  = [...ts.matchAll(/"id": "(\d+)"/g)].map(m => parseInt(m[1]));
  let nextId = existingIds.length > 0 ? Math.max(...existingIds) + 1 : 100;

  const hasTranslation = !!process.env.ANTHROPIC_API_KEY;
  // Claude 呼び出し上限（J-REITは別カウンター・優先枠）
  const MAX_CLAUDE_JREIT = 30;  // J-REIT は多めに割り当て
  const MAX_CLAUDE_OTHER = 40;  // その他カテゴリ（解説カバー率向上のため引き上げ）
  let claudeJREIT = 0;
  let claudeOther = 0;

  const QUERIES = buildQueries();

  console.log(`既存記事数: ${existingIds.length} 件`);
  console.log(`コンテンツ生成: ${hasTranslation ? `✅ ON (JREIT最大${MAX_CLAUDE_JREIT}件 / その他${MAX_CLAUDE_OTHER}件)` : '⚠️  OFF (ANTHROPIC_API_KEY なし)'}`);
  console.log(`J-REIT クエリ: ${QUERIES.filter(q => q.category === 'JREIT').length} 件 (直近3日: ${daysAgo(3)} 以降)`);
  console.log('📡 Google News RSS を取得中...\n');

  const newArticles = [];
  const seenUrls    = new Set(existingUrls);

  for (const { keyword, category: baseCategory } of QUERIES) {
    process.stdout.write(`  [${baseCategory}] "${keyword.slice(0, 50)}" ... `);
    try {
      const xml   = await fetchRss(keyword);
      let items   = parseRssItems(xml);
      let added   = 0;

      // J-REITクエリの場合、優先ソースを先頭に並び替え
      if (baseCategory === 'JREIT') {
        items = [
          ...items.filter(i => isJREITPrioritySource(i.link)),
          ...items.filter(i => !isJREITPrioritySource(i.link)),
        ];
      }

      for (const item of items) {
        if (seenUrls.has(item.link)) continue;
        seenUrls.add(item.link);

        const publishedAt = item.pubDate
          ? new Date(item.pubDate).toISOString()
          : new Date().toISOString();

        let title       = item.title;
        let description = (item.description || item.title).slice(0, 120);
        let content     = item.description || item.title;

        // ── カテゴリ確定：投資法人名が含まれれば JREIT に強制分類 ──
        const effectiveCategory =
          baseCategory !== 'JREIT' && detectJREIT(title, item.source)
            ? 'JREIT'
            : baseCategory;

        // ── JREIT は「具体的な物件取得・売却」のみに厳格限定 ──
        if (effectiveCategory === 'JREIT' && !isJREITTransaction(title)) {
          continue; // 市況・指数・決算・公募などは除外
        }

        // ── 不動産金融に無関係な記事を除外（JREIT以外） ──
        if (effectiveCategory !== 'JREIT' && !isRelevantToRealEstateFinance(title, item.description || '', item.source)) {
          continue;
        }

        const isEng    = isEnglish(title);
        const isJREIT_ = effectiveCategory === 'JREIT';

        // ── Claude でリッチコンテンツ生成 ──
        // J-REIT は優先枠内で常に生成、その他は上限内で生成
        const canEnrich = hasTranslation && (
          isJREIT_ ? claudeJREIT < MAX_CLAUDE_JREIT
                   : claudeOther < MAX_CLAUDE_OTHER
        );

        if (canEnrich) {
          process.stdout.write('\n    ✍️  生成中: ' + title.slice(0, 45) + '... ');
          const rich = await generateRichContent(
            title, item.description || item.title, effectiveCategory, isEng,
          );
          if (rich && rich.relevant === false) {
            process.stdout.write('(無関係 → 除外)\n');
            isJREIT_ ? claudeJREIT++ : claudeOther++;
            await sleep(300);
            continue; // この記事を追加しない
          }
          if (rich && rich.description && rich.content) {
            if ((isEng || isJREIT_) && rich.title) title = rich.title;
            description = rich.description.slice(0, 120);
            content     = rich.content;
            isJREIT_ ? claudeJREIT++ : claudeOther++;
            process.stdout.write('✅\n');
          } else {
            process.stdout.write('(スキップ)\n');
          }
          await sleep(300);
        }

        newArticles.push({
          id:          String(nextId++),
          title,
          description,
          content,
          category:    effectiveCategory,
          author:      item.source,
          publishedAt,
          imageUrl:    pickImage(effectiveCategory),
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
  // 直前の既存記事との間にカンマが必要かチェック（JSON.stringifyで書き直した場合はカンマなし）
  const before = ts.slice(0, insertPoint).trimEnd();
  const separator = before.endsWith('}') ? ',\n' : '\n';
  ts = ts.slice(0, insertPoint) + separator + newEntries + ',\n' + ts.slice(insertPoint);
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
