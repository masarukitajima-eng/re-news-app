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

const SENDER_PATTERN  = /堀江貴文|horiemon|mag2.*0001092981|mag2premium/i;
const SUBJECT_PATTERN = /堀江貴文|ホリエモン|vol\.\d+|0001092981/i;
const FETCH_COUNT     = 5; // 最新N件を取得

// 検索対象メールボックス（INBOX + すべてのメール）
const MAILBOXES_TO_SEARCH = ['INBOX', '[Gmail]/All Mail'];
// 検索する送信者パターン
const SEARCH_FROM_PATTERNS = ['@mag2.com', '@mag2premium.com'];

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
  const snippet = bodyText.slice(0, 3000); // 最初の3000文字を使用

  const prompt = `あなたは堀江貴文のメルマガを読み込んでいる日本語ライターです。

以下のメルマガ本文を読み、読者が価値を感じられるよう3セクションで要約してください。

件名: ${subject}
本文（抜粋）:
${snippet}

以下の3セクション構成で執筆してください:
- 【要約】: メルマガの核心メッセージを堀江氏の視点・言葉に寄り添って2〜3文で
- 【日本への影響】: この内容が日本のビジネス・社会・不動産市場にどう影響するか独自の視点で2〜3文
- 【注目点】: 堀江氏ならではの切り口・斬新なビジネスモデルの視点・行動指針を2〜3文

JSONのみで返してください（コードブロック不要）:
{
  "title": "第XXX号｜（メインテーマを20〜40文字で表現したタイトル）",
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

  // 複数メールボックス × 複数送信者パターンで広範囲に検索
  const messages = [];
  const seenMsgIds = new Set();

  for (const mailbox of MAILBOXES_TO_SEARCH) {
    try {
      await imap.mailboxOpen(mailbox, { readOnly: true });
      console.log(`  📂 ${mailbox} を検索中...`);
    } catch (e) {
      console.log(`  ⚠️  ${mailbox}: スキップ (${e.message})`);
      continue;
    }

    // 送信者ドメインで検索
    for (const fromPat of SEARCH_FROM_PATTERNS) {
      try {
        for await (const message of imap.fetch(
          { from: fromPat },
          { uid: true, envelope: true, source: true },
        )) {
          const from    = (message.envelope.from || []).map(f => `${f.name || ''} ${f.address || ''}`).join(' ');
          const subject = message.envelope.subject || '';
          const msgId   = message.envelope.messageId || `${mailbox}-${message.uid}`;
          if (seenMsgIds.has(msgId)) continue;
          if (SENDER_PATTERN.test(from) || SENDER_PATTERN.test(subject) || SUBJECT_PATTERN.test(subject)) {
            seenMsgIds.add(msgId);
            messages.push(message);
          }
        }
      } catch (e) {
        console.log(`  ⚠️  ${fromPat} 検索エラー: ${e.message}`);
      }
    }

    // キーワードで追加検索（件名に「堀江貴文」or「0001092981」）
    for (const keyword of ['堀江貴文', '0001092981']) {
      try {
        for await (const message of imap.fetch(
          { subject: keyword },
          { uid: true, envelope: true, source: true },
        )) {
          const msgId = message.envelope.messageId || `${mailbox}-${message.uid}`;
          if (!seenMsgIds.has(msgId)) {
            seenMsgIds.add(msgId);
            messages.push(message);
          }
        }
      } catch (e) {
        console.log(`  ⚠️  件名検索 "${keyword}" エラー: ${e.message}`);
      }
    }
  }

  // 最新N件に絞る（日付降順）
  const targets = messages
    .sort((a, b) => new Date(b.envelope.date) - new Date(a.envelope.date))
    .slice(0, FETCH_COUNT);

  console.log(`📩 ホリエモンメルマガ: ${messages.length} 件 → 最新 ${targets.length} 件を処理`);

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
