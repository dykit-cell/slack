const puppeteer = require('puppeteer');
const crypto = require('crypto');
const axios = require('axios');
const fs = require('fs');

// ログインURLとターゲットURL
const loginUrl = 'https://www.swim-g.net/cgi-bin/dneo/dneo.cgi?cmd=login';
const targetUrl = 'https://www.swim-g.net/cgi-bin/dneo/dneo.cgi?';  // ログイン後にアクセスするURL

// Slack Bot TokenとチャンネルID (環境変数から取得)
// GitHub ActionsのSecretsに SLACK_BOT_TOKEN と SLACK_CHANNEL を設定してください
const slackBotToken = process.env.SLACK_BOT_TOKEN;
const slackChannel = process.env.SLACK_CHANNEL;

// ログインに使用するIDとパスワード (機密情報のため、こちらも環境変数化を強く推奨します)
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

// Slackにメッセージを送信する共通関数
async function sendSlackMessage(message, attachments = []) {
    if (!slackBotToken || !slackChannel) {
        console.error('致命的なエラー: Slack Bot TokenまたはチャンネルIDが環境変数として設定されていません。GitHub ActionsのSecretsを確認してください。');
        throw new Error('Slack Bot Token or channel ID environment variable is not configured.');
    }

    try {
        await axios.post('https://slack.com/api/chat.postMessage', {
            channel: slackChannel, // チャンネルIDを使用
            text: message,
            attachments: attachments
        }, {
            headers: {
                'Authorization': `Bearer ${slackBotToken}`,
                'Content-Type': 'application/json'
            }
        });
        console.log('Slackへの通知が成功しました。');
    } catch (error) {
        console.error('Slack通知の送信に失敗しました:', error.message);
        if (error.response) {
            console.error('Slack APIからのエラーレスポンス:', error.response.data);
            console.error('Slack APIからのステータスコード:', error.response.status);
            if (error.response.data && error.response.data.error === 'invalid_auth') {
                console.error('エラー: Slack Bot Tokenが無効です。Slackアプリの認証情報を確認してください。');
            } else if (error.response.data && error.response.data.error === 'channel_not_found') {
                console.error('エラー: SlackチャンネルIDが見つかりません。IDを確認してください。');
            }
        }
        throw error; // エラーを再スローし、GitHub Actionsのジョブを失敗させる
    }
}

// Puppeteerを使ってログイン後のページを操作する関数
async function checkForUpdates() {
    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'], // サンドボックスを無効化
    });
        
    const page = await browser.newPage();

    try {
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
            await sendSlackMessage('エラー: ログインボタンが見つからないか、クリックできませんでした。スクレイピング処理を中止します。');
            return; // 処理を中断
        }

        // ログイン後、ターゲットページに遷移
        await page.waitForNavigation();  // ログイン後のページ遷移を待つ

        // ページ内容が完全にロードされるまで待機
        try {
            await page.waitForSelector('p.portal-listitem-text-inner', { timeout: 15000 }); // 15秒まで待機
        } catch (error) {
            console.error('エラー: `p.portal-listitem-text-inner` 要素が見つかりませんでした。ページ構造が変わった可能性があります。', error);
            await sendSlackMessage('エラー: 回覧板の要素が見つかりませんでした。ウェブサイトの構造変更を確認してください。');
            return; // 処理を中断
        }

        // `tr.portal-item-expired` 内のリンクテキストを取得
        const contentToCheck = await page.$eval('p.portal-listitem-text-inner a', element => element.textContent.trim());
        console.log('取得した回覧板コンテンツ:', contentToCheck);

        // コンテンツのハッシュを計算
        let lastContentHash = loadLastContentHash(); // ファイルから前回のハッシュを読み込む
        const currentHash = crypto.createHash('md5').update(contentToCheck).digest('hex');

        // コンテンツが変更されたかどうかをチェック
        if (currentHash !== lastContentHash) {
            console.log('Content has changed!');
            console.log('旧ハッシュ:', lastContentHash);
            console.log('新ハッシュ:', currentHash);

            // コンテンツが更新された場合にのみ通知する
            await sendSlackMessage(
                `<!channel>デスクネッツの回覧板が更新されました！`,
                [
                    {
                        fallback: 'Updated content',
                        text: `\`\`\`\n${contentToCheck}\n\`\`\``, // HTMLとして表示
                    }
                ]
            );

            // 現在のハッシュをファイルに保存
            saveContentHash(currentHash);

        } else {
            console.log('更新はありません');
        }

    } catch (error) {
        console.error('スクリプト実行中にエラーが発生しました:', error);
        // エラー発生時は通知
        await sendSlackMessage(`致命的なエラーが発生しました: ${error.message}. ログを確認してください。`);
    } finally {
        // ブラウザを閉じる
        await browser.close();
    }
}

// スクリプトの実行
checkForUpdates();
