# nest-signal-handler

NestJS アプリケーションが SIGTERM をどのように処理するかを確認するための最小プロジェクト。

## 使い方

```sh
npm install
npm run build
npm start                              # PORT 環境変数で待ち受けポートを変更できる
curl 'localhost:3000/sleep?ms=5000'    # 処理中リクエストがある状態を作る（完了を待ってから終了する）
curl 'localhost:3000/cancellable-sleep?ms=5000'  # SIGTERM で中断して 503 を返す
kill -TERM <pid>                       # 起動ログに表示される pid に送る
```

`npm test` は起動したアプリに SIGTERM を送り、ライフサイクルフックの呼び出し順、`/cancellable-sleep` の中断、終了状態を検証する。

## 実行例

`/cancellable-sleep` へのリクエストを 2 件処理している間に SIGTERM を送った例。

```sh
# ターミナル 1
npm start

# ターミナル 2
curl -D - localhost:3000/cancellable-sleep?ms=50000 &
curl -D - localhost:3000/cancellable-sleep?ms=40000 &
kill 1105036   # 起動ログに表示される pid。kill はデフォルトで SIGTERM を送る
```

ターミナル 2 では、2 件の curl がそれぞれ次のレスポンスを受け取る。

```
HTTP/1.1 503 Service Unavailable
X-Powered-By: Express
Content-Type: application/json; charset=utf-8
Content-Length: 81
ETag: W/"51-R3BqVgmHiG7uiGM557M1QiKce4o"
Date: Thu, 01 Oct 2026 14:53:36 GMT
Connection: keep-alive
Keep-Alive: timeout=5

{"message":"cancelled by SIGTERM","error":"Service Unavailable","statusCode":503}
```

ターミナル 1 には次のログを出力する（起動時のログは省略）。

```
[Nest] 1105036  - 10/01/2026, 11:53:01 PM     LOG [Bootstrap] listening on http://[::1]:3000 (pid=1105036)
[Nest] 1105036  - 10/01/2026, 11:53:12 PM     LOG [AppController] cancellable sleep start (50000ms)
[Nest] 1105036  - 10/01/2026, 11:53:20 PM     LOG [AppController] cancellable sleep start (40000ms)
[Nest] 1105036  - 10/01/2026, 11:53:36 PM     LOG [ShutdownObserver] onModuleDestroy
[Nest] 1105036  - 10/01/2026, 11:53:36 PM     LOG [ShutdownObserver] beforeApplicationShutdown signal=SIGTERM
[Nest] 1105036  - 10/01/2026, 11:53:36 PM    WARN [AppController] cancellable sleep cancelled by SIGTERM
[Nest] 1105036  - 10/01/2026, 11:53:36 PM    WARN [AppController] cancellable sleep cancelled by SIGTERM
[Nest] 1105036  - 10/01/2026, 11:53:36 PM     LOG [ShutdownObserver] onApplicationShutdown signal=SIGTERM
Terminated
```

SIGTERM を受けると、Nest は次の順に終了処理を行う（`@nestjs/core` の `NestApplicationContext.runShutdownSequence`）。

1. `onModuleDestroy` を呼ぶ
2. `beforeApplicationShutdown` を呼ぶ。`ShutdownSignal` がここで `AbortController` を中断し、処理中の `/cancellable-sleep` はすべて待機を打ち切って 503 を返す
3. HTTP サーバーを閉じる。処理中のリクエストがあれば完了を待つ
4. `onApplicationShutdown` を呼ぶ
5. 自身のシグナルハンドラを外し、受け取ったシグナルを自プロセスに送り直す

中断ログが `beforeApplicationShutdown` の後かつ `onApplicationShutdown` の前に出ていることから、3 でサーバーを閉じる前に 2 件とも応答を返したとわかる。最後の `Terminated` は、プロセスが SIGTERM で終了したことを示すシェルの表示で、5 によるもの。終了コードは 143（128 + 15）になる。

`/sleep` は中断を受け付けないため、3 で sleep の完了を待ってから終了する。
