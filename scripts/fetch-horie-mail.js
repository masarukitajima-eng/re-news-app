/**
 * 堀江貴文メルマガ（mag2: 0001092981）をGmailから取得してmockNews.tsに追記するスクリプト
 *
 * 【初回セットアップ】
 * 1. Googleアカウントで2段階認証を有効化
 * 2. https://myaccount.google.com/apppasswords でアプリパスワードを生成
 * 3. .env.local に以下を追加:
 *      GMAIL_USER=あなたのGmailアドレス
 *      GMAIL_APP_PASSWORD=生成したアプリパスワード（スペースなし16文字）
 * 4. GitHub Secrets にも同様に GMAIL_USER / GMAIL_APP_PASSWORD を登録
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

// INBOX に対してこの順で検索し、ヒットした全件を重複排除してマージ
const SEARCH_QUERIES = [
  { from: 'mailmag@mag2premium.com' }, // ① 優先: 正確な送信元
  { from: '@mag2.com' },               // ② 次点: mag2.com ドメイン全般
  { subject: '堀江貴文' },              // ③ 件名キーワード
];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// メール本文（HTML含む）からプレーンテキストを抽出
function extractText(body) {
  return body
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// メール件名から号数を抽出
function extractIssueNumber(subject) {
  const m = subject.match(/(?:vol\.?|第)\s*(\d+)/i);
  return m ? m[1] : null;
}

async function generateHorieContent(client, subject, bodyText) {
  const snippet = bodyText.slice(0, 3000);

  const prompt = `以下のメルマガ情報をJSON形式だけで返してください。説明文・謝罪文・コードブロック不要。

件名: ${subject}
本文（抜粋）:
${snippet}

必ずこのJSON形式のみ返すこと:
{"title":"第XXX号｜テーマ（20〜40文字）","description":"記事の核心（120文字以内）","content":"【要約】: 2〜3文。\\n\\n【日本への影響】: 2〜3文。\\n\\n【注目点】: 2〜3文。"}`;

  for (let attempt = 1; attempt <= 2; attempt++) {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1200,
      messages: [{ role: 'user', content: prompt }],
    });

    const raw = response.content[0].text.trim()
      .replace(/^```json\s*/i, '').replace(/\s*```$/i, '');

    // JSON ブロックだけ抽出して parse
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]);
      } catch { /* retry */ }
    }
    if (attempt < 2) await sleep(500);
  }

  // 2回失敗したら件名から最低限の記事を生成
  const issueNum = extractIssueNumber(subject) || '';
  return {
    title:       issueNum ? `第${issueNum}号｜${subject.replace(/《\d+-\d+》|《\d+》/g, '').trim().slice(0, 35)}` : subject.slice(0, 40),
    description: subject.slice(0, 120),
    content:     `【要約】: ${subject}。\n\n【日本への影響】: 堀江貴文氏の視点から日本のビジネス・社会に示唆を与える内容です。\n\n【注目点】: メルマガ全文で詳細を確認できます。`,
  };
}

async function main() {
  const gmailUser = process.env.GMAIL_USER;
  const gmailPass = process.env.GMAIL_APP_PASSWORD;
  const apiKey    = process.env.ANTHROPIC_API_KEY;

  if (!gmailUser || !gmailPass) {
    console.error('❌ GMAIL_USER または GMAIL_APP_PASSWORD が設定されていません');
    console.error('   .env.local に GMAIL_USER と GMAIL_APP_PASSWORD を追加してください');
    process.exit(1);
  }
  if (!apiKey) {
    console.error('❌ ANTHROPIC_API_KEY が設定されていません');
    process.exit(1);
  }

  let ImapFlow;
  try {
    ImapFlow = require('imapflow').ImapFlow;
  } catch {
    console.error('❌ imapflow が見つかりません。インストールしてください:');
    console.error('   npm install imapflow --save');
    process.exit(1);
  }

  const { Anthropic } = require('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey });

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

  // シンプルに3クエリで検索 → 重複排除してマージ
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

  // 既存URLのチェック（重複防止）
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
    const subject = msg.envelope.subject || '（件名なし）';
    const msgId   = msg.envelope.messageId || `horie-${msg.envelope.date}`;
    const articleUrl = `https://www.mag2.com/m/0001092981#${encodeURIComponent(msgId)}`;

    if (existingUrls.has(articleUrl)) {
      console.log(`  スキップ (既存): ${subject.slice(0, 50)}`);
      continue;
    }

    process.stdout.write(`[${i + 1}/${targets.length}] "${subject.slice(0, 50)}" → `);

    // メール本文をテキスト変換
    const bodyText = extractText(msg.source?.toString('utf8') || subject);

    try {
      const rich = await generateHorieContent(client, subject, bodyText);
      const issueNum = extractIssueNumber(subject) || extractIssueNumber(rich.title || '');
      const issueLabel = issueNum ? `堀江貴文メルマガ vol.${issueNum}` : '堀江貴文メルマガ';

      newArticles.push({
        id:          String(nextId++),
        title:       rich.title || subject,
        description: (rich.description || subject).slice(0, 120),
        content:     rich.content,
        category:    'HORIE',
        author:      '堀江貴文',
        publishedAt: new Date(msg.envelope.date).toISOString(),
        imageUrl:    HORIE_IMAGES[i % HORIE_IMAGES.length],
        source:      issueLabel,
        url:         articleUrl,
        readTime:    Math.max(1, Math.round(rich.content.length / 400)),
      });
      console.log('✅ ' + (rich.title || subject).slice(0, 50));
    } catch (e) {
      console.log(`⚠️  スキップ (${e.message})`);
    }

    await sleep(300);
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
  const before = ts.slice(0, insertPoint).trimEnd();
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
