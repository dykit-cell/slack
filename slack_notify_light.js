const puppeteer = require('puppeteer');
const crypto = require('crypto');
const axios = require('axios');
const fs = require('fs');

// ログインURLとターゲットURL
const loginUrl = 'https://www.swim-g.net/cgi-bin/dneo/dneo.cgi?cmd=login';
const targetUrl = 'https://www.swim-g.net/cgi-bin/dneo/dneo.cgi?';  // ログイン後にアクセスするURL
const slackWebhookUrl = 'https://hooks.slack.com/services/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'; // Slack Webhook URL

// ログインに使用するIDとパスワード
const username = '48025';  // ユーザーID
const password = 'tjtdks';  // パスワード

// ハッシュを保存するファイルのパス
const hashFilePath = './lastContentHash.txt';

// 前回のハッシュをファイルから読み込む関数
function loadLastContentHash() {
    if (fs.existsSync(hashFilePath)) {
        return fs.readFileSync(hashFilePath, 'utf-8');
    }
    return null;
}

// ハッシュをファイルに保存する関数
function saveContentHash(hash) {
    try {
        fs.writeFileSync(hashFilePath, hash, 'utf-8');
        console.log("新しいハッシュを保存しました:", hash);
    } catch (err) {
        console.error('ハッシュの保存に失敗しました:', err);
    }
}



// Puppeteerを使ってログイン後のページを操作する関数
async function checkForUpdates() {
    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'], // サンドボックスを無効化
    });
        
    const page = await browser.newPage();

    // ログインページにアクセス
    await page.goto(loginUrl, { timeout: 0 });

    // ログインフォームにIDとパスワードを入力して送信
    await page.type('input[name="UserID"]', username);  // ユーザーID入力
    await page.type('input[name="_word"]', password);  // パスワード入力

    // クリック前にボタンが表示されるのを待つ
    await page.waitForSelector('input[type="submit"]', { visible: true });

    // ログインボタンを取得
    const loginButton = await page.$('input[type="submit"]');

    // ボタンをクリック（`evaluate`を使用してブラウザ内で直接クリック）
    if (loginButton) {
        await loginButton.evaluate(button => button.click()); // `evaluate`を使ってクリック
    } else {
        console.error('Login button not found or not clickable');
    }

    // ログイン後、ターゲットページに遷移
    await page.waitForNavigation();  // ログイン後のページ遷移を待つ

    // ページ内容が完全にロードされるまで待機
    await page.waitForSelector('tr.portal-item-expired');

    // ページ内容を取得
    const content = await page.content();

    // `tr.portal-item-expired` の最初の要素のHTMLを取得
    const expiredItemHtml = await page.$eval('tr.portal-item-expired', element => element.outerHTML);

    // `tr.portal-item-expired` 内のリンクテキストを取得
    const contentToCheck = await page.$eval('tr.portal-item-expired a', element => element.textContent.trim());
    console.log(contentToCheck);


    // コンテンツのハッシュを計算
    let lastContentHash = loadLastContentHash(); // ファイルから前回のハッシュを読み込む
    const currentHash = crypto.createHash('md5').update(contentToCheck).digest('hex');

    // コンテンツが変更されたかどうかをチェック
    if (currentHash !== lastContentHash) {
        console.log('Content has changed!');
        console.log(currentHash, lastContentHash);
        await axios.post(slackWebhookUrl, {
            text: `<!channel>デスクネッツの回覧板が更新されました！`,
            attachments: [
                {
                    fallback: 'Updated content',
                    text: `\`\`\`\n${contentToCheck}\n\`\`\``, // HTMLとして表示
                }
            ]
        });

        // 現在のハッシュをファイルに保存
        saveContentHash(currentHash);

    } else {
        console.log('更新はありません');
    }

    // 更新があった場合もなかった場合も要素のHTMLを表示
    console.log(' 最新の回覧板HTML');
    console.log(contentToCheck);  // 要素のHTMLを表示

    await axios.post("https://hooks.slack.com/services/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", {
        text: `回覧板状況 `,
        attachments: [
            {
                fallback: 'Updated content',
                text: `\`\`\`\n${contentToCheck}\n\`\`\``, // HTMLとして表示
            }
        ]
    });

    // ブラウザを閉じる
    await browser.close();
}
checkForUpdates();