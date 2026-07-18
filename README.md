# Mokko-V5

## 日繰り表アプリ（higuri）

資金繰りを管理する単一HTMLファイルのPWAです。

### 使い方

1. `higuri.html` または `index.html` をブラウザで開く（Mac / iPad 両対応）
2. iPadでは「ホーム画面に追加」でアプリのように利用可能
3. データはブラウザの localStorage に自動保存されます
4. Dropbox同期を使う場合は「設定」タブで App Key を入力して接続

### 機能

- Excel風の日繰表表示（月日／内容／口座別内訳／入金／出金／残高）
- 入出金の手入力・編集・削除
- 分割入出金（視覚的グルーピング）
- カード払い切替（引落日への自動付替・集計行生成）
- 借入金マスタ（長期・短期）からの自動計上
- 固定費マスタからの自動計上
- Dropbox API（PKCE OAuth）による JSON 同期
- JSON エクスポート／インポート
- 営業日カレンダー（外部祝日JSON取込、カード引落日の翌営業日繰越）

### 仕様書

詳細は [docs/higuri-app-spec.md](docs/higuri-app-spec.md) を参照してください。
