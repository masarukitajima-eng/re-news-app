/**
 * 堀江貴文メルマガ（mag2: 0001092981）をGmailから取得してmockNews.tsに追記するスクリプト
 * ※ AI要約なし・本文全文をそのまま保存
 *
 * 使い方: node scripts/fetch-horie-mail.js
 */

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

const FETCH_COUNT = 5; // 最新N件を取得

// INBOX に対してこの順で検索し、重複排除してマージ
const SEARCH_QUERIES = [
  { from: 'mailmag@mag2premium.com' }, // ① 優先: 正確な送信元
  { from: '@mag2.com' },               // ② 次点: mag2.com ドメイン全般
  { subject: '堀江貴文' },              // ③ 件名キーワード
];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// メール件名から号数を抽出
function extractIssueNumber(subject) {
  // 《840-3》 形式
  const partMatch = subject.match(/《(\d+)-(\d+)》/);
  if (partMatch) return `${partMatch[1]}-${partMatch[2]}`;
  // vol. 形式
  const volMatch = subject.match(/(?:vol\.?|第)\s*(\d+)/i);
  if (volMatch) return volMatch[1];
  return null;
}

// mailparser で本文（text/plain優先、なければHTMLをテキスト化）を取得
async function parseEmailBody(rawSource) {
  const { simpleParser } = require('mailparser');
  const parsed = await simpleParser(rawSource);

  if (parsed.text && parsed.text.trim().length > 100) {
    return parsed.text.trim();
  }
  // HTML フォールバック
  if (parsed.html) {
    return parsed.html
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<\/div>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\n{4,}/g, '\n\n\n')
      .trim();
  }
  return parsed.subject || '';
}

async function main() {
  const gmailUser = process.env.GMAIL_USER;
  const gmailPass = process.env.GMAIL_APP_PASSWORD;

  if (!gmailUser || !gmailPass) {
    console.error('❌ GMAIL_USER または GMAIL_APP_PASSWORD が設定されていません');
    process.exit(1);
  }

  let ImapFlow;
  try {
    ImapFlow = require('imapflow').ImapFlow;
  } catch {
    console.error('❌ imapflow が見つかりません: npm install imapflow --save');
    process.exit(1);
  }

  console.log(`📬 Gmail (${gmailUser}) に接続中...`);

  const imap = new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: { user: gmailUser, pass: gmailPass },
    logger: false,
  });

  await imap.connect();
  await imap.mailboxOpen('INBOX', { readOnly: true });
  console.log('  📂 INBOX を検索中...');

  // 3クエリで検索 → 重複排除してマージ
  const messages = [];
  const seenMsgIds = new Set();

  for (const query of SEARCH_QUERIES) {
    const label = JSON.stringify(query);
    try {
      let count = 0;
      for await (const message of imap.fetch(
        query,
        { uid: true, envelope: true, source: true },
      )) {
        const msgId = message.envelope.messageId || `inbox-${message.uid}`;
        if (!seenMsgIds.has(msgId)) {
          seenMsgIds.add(msgId);
          messages.push(message);
          count++;
        }
      }
      console.log(`  ✓ ${label}: ${count} 件`);
    } catch (e) {
      console.log(`  ⚠️  ${label}: スキップ (${e.message})`);
    }
  }

  // 最新N件に絞る（日付降順）
  const targets = messages
    .sort((a, b) => new Date(b.envelope.date) - new Date(a.envelope.date))
    .slice(0, FETCH_COUNT);

  console.log(`📩 合計 ${messages.length} 件 → 最新 ${targets.length} 件を処理`);

  await imap.logout();

  if (targets.length === 0) {
    console.log('✅ 新しいメルマガはありません');
    return;
  }

  // mockNews.ts を読み込み
  const mockPath = path.join(__dirname, '..', 'src', 'data', 'mockNews.ts');
  let ts = fs.readFileSync(mockPath, 'utf8');
  const existingIds = [...ts.matchAll(/"id": "(\d+)"/g)].map(m => parseInt(m[1]));
  let nextId = existingIds.length > 0 ? Math.max(...existingIds) + 1 : 2000;

  // 既存URLチェック（重複防止）
  const existingUrls = new Set([...ts.matchAll(/"url": "([^"]+)"/g)].map(m => m[1]));

  const HORIE_IMAGES = [
    'https://images.unsplash.com/photo-1677442135703-1787eea5ce01?w=800&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1620712943543-bcc4688e7485?w=800&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1485827404703-89b55fcc595e?w=800&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1518186285589-2f7649de83e0?w=800&auto=format&fit=crop',
  ];

  const newArticles = [];

  for (let i = 0; i < targets.length; i++) {
    const msg = targets[i];
    const subject  = msg.envelope.subject || '（件名なし）';
    const msgId    = msg.envelope.messageId || `horie-${msg.envelope.date}`;
    const articleUrl = `https://www.mag2.com/m/0001092981#${encodeURIComponent(msgId)}`;

    if (existingUrls.has(articleUrl)) {
      console.log(`  スキップ (既存): ${subject.slice(0, 60)}`);
      continue;
    }

    process.stdout.write(`[${i + 1}/${targets.length}] "${subject.slice(0, 60)}" → `);

    // ★ 全文取得（AI要約なし）
    const fullText = msg.source
      ? await parseEmailBody(msg.source)
      : subject;

    const issueNum   = extractIssueNumber(subject);
    const issueLabel = issueNum ? `堀江貴文メルマガ vol.${issueNum}` : '堀江貴文メルマガ';

    // タイトルは件名から装飾を除いて整形
    const cleanTitle = subject
      .replace(/《\d+-\d+》|《\d+》/g, '')
      .replace(/堀江貴文のブログでは言えない話/g, '')
      .replace(/【(.+?)】/g, '$1')
      .trim()
      .slice(0, 60) || subject.slice(0, 60);

    // description は本文の先頭120文字
    const description = fullText
      .replace(/\n+/g, ' ')
      .trim()
      .slice(0, 120);

    newArticles.push({
      id:          String(nextId++),
      title:       issueNum ? `第${issueNum}号｜${cleanTitle}` : cleanTitle,
      description,
      content:     fullText,
      category:    'HORIE',
      author:      '堀江貴文',
      publishedAt: new Date(msg.envelope.date).toISOString(),
      imageUrl:    HORIE_IMAGES[i % HORIE_IMAGES.length],
      source:      issueLabel,
      url:         articleUrl,
      readTime:    Math.max(1, Math.round(fullText.length / 600)),
    });
    console.log(`✅ ${fullText.length.toLocaleString()} 文字`);

    await sleep(100);
  }

  if (newArticles.length === 0) {
    console.log('\n✅ 追加する記事はありませんでした');
    return;
  }

  // mockNews.ts に追記
  const insertPoint = ts.lastIndexOf('];');
  const newEntries  = newArticles
    .map(a => '  ' + JSON.stringify(a, null, 2).replace(/\n/g, '\n  '))
    .join(',\n');
  const before    = ts.slice(0, insertPoint).trimEnd();
  const separator = before.endsWith('}') ? ',\n' : '\n';
  ts = ts.slice(0, insertPoint) + separator + newEntries + ',\n' + ts.slice(insertPoint);
  fs.writeFileSync(mockPath, ts, 'utf8');

  const total = [...ts.matchAll(/"id": "(\d+)"/g)].length;
  console.log(`\n✅ ${newArticles.length} 件追加 → 合計 ${total} 件`);
  fs.writeFileSync(path.join(__dirname, '..', '.news-updated'), String(newArticles.length));
}

main().catch(e => {
  console.error('❌ エラー:', e.message);
  process.exit(1);
});
