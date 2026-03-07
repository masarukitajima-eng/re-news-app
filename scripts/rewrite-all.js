// 解説なし記事を全件リライトするラッパー
// rewrite-latest.js を書き直し対象が0になるまで繰り返し実行
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

let round = 0;
const maxRounds = 20;

while (round < maxRounds) {
  round++;
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  Round ${round} / max ${maxRounds}`);
  console.log(`${'='.repeat(60)}\n`);

  try {
    const output = execSync('node scripts/rewrite-latest.js', {
      cwd: path.join(__dirname, '..'),
      encoding: 'utf8',
      timeout: 10 * 60 * 1000, // 10 minutes per round
      stdio: ['inherit', 'pipe', 'pipe'],
    });
    console.log(output);

    // "書き直し対象: 0 件" が出たら完了
    if (output.includes('\u66F8\u304D\u76F4\u3057\u5BFE\u8C61: 0 \u4EF6')) {
      console.log('\n全記事の解説付与が完了しました！');
      break;
    }
  } catch (e) {
    console.error('Error in round', round, ':', e.message);
    if (e.stdout) console.log(e.stdout);
    if (e.stderr) console.error(e.stderr);
    break;
  }
}

if (round >= maxRounds) {
  console.log(`\n${maxRounds}ラウンド実行しましたが、まだ残りがあるかもしれません。`);
}
