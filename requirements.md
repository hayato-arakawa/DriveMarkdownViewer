# Drive Markdown Viewer — 要件定義書

## 1. 概要

Google Drive のファイルプレビュー画面（`https://drive.google.com/file/d/*/view*`）上で、Markdownファイル（`.md` / `.markdown`）のテキストをレンダリングし、整形された状態で閲覧できるChrome拡張機能。

---

## 2. 対象環境

| 項目 | 値 |
|---|---|
| ブラウザ | Google Chrome |
| Manifest | V3 |
| 対象ページ | `https://drive.google.com/file/d/*/view*` |
| 実行タイミング | `document_idle` |

---

## 3. 機能要件

### 3.1 トリガー条件

- URL が `https://drive.google.com/file/d/{fileId}/view*` にマッチした場合にcontent scriptが読み込まれる
- ファイル種別の判定は不要（全てのファイルプレビューにMDボタンを表示）

### 3.2 コンテンツ取得

> [!IMPORTANT]
> **API fetchは使用しない**。Driveプレビューページ内のDOMから直接テキストを取得する（CORS回避のため）。

| 優先度 | 取得方法 | セレクタ |
|---|---|---|
| 1（最優先） | `<pre>` 要素からtextContent | `div.a-b-r > div > div > div > pre` |
| 2 | Drive プレビュー内の `<pre>` 全検索 | `div.a-b-r pre`, `div.a-b-ah pre` |
| 3 | Legacy フォールバック | `.drive-viewer-text-page`, `[class*="text-page"]` 等 |
| 4 | white-space スタイル持ちの div | `div[style*="white-space"]`（20文字以上） |

#### ファイル名の取得

```
div.exjswb > span > span > span
```
フォールバック: `document.title`

### 3.3 Markdown レンダリング

| 項目 | 仕様 |
|---|---|
| パーサー | [marked.min.js](file:///Users/nakamegurokoumylab/Downloads/DriveMarkdownViewer/lib/marked.min.js)（GFM, breaks: true） |
| サニタイズ | [purify.min.js](file:///Users/nakamegurokoumylab/Downloads/DriveMarkdownViewer/lib/purify.min.js)（DOMPurify, HTMLプロファイル） |
| フォールバック | 基本的なMarkdown変換（h1–h3, bold, italic, code, 改行） |

#### サポートするMarkdown構文

- 見出し（h1–h6）
- 太字・斜体
- リンク
- リスト（ul, ol）
- 引用（blockquote）
- インラインコード・コードブロック
- テーブル
- 水平線
- 画像
- タスクリスト（チェックボックス）

### 3.4 UIトグルボタン

- **位置**: Driveファイルプレビューのツールバー内に挿入
- **ラベル**: `MD`（アイコン + テキスト）
- **動作**: クリックでMarkdown表示 ↔ 元の表示をトグル
- **状態表示**:
  - 非アクティブ: 半透明の背景
  - アクティブ: 青色グラデーション背景 + ラベル「元に戻す」
  - ローディング: スピナー + 「読み込み中…」

#### ボタン挿入のセレクタ優先順位

1. `[data-tooltip="Google ドキュメント で開く"]` 等のアンカー要素の親コンテナ
2. `[role="toolbar"]`, `[class*="toolbar"]` 等
3. `header`, `[role="banner"]` の末尾

### 3.5 表示方式

> [!IMPORTANT]
> **全画面オーバーレイは使用しない**。Driveプレビューのコンテンツ領域内にインライン表示する。

| モード | 条件 | 表示先 |
|---|---|---|
| **インライン（主）** | コンテナ検出成功時 | `div.a-b-r > div > div` 内に挿入 |
| **オーバーレイ（副）** | コンテナ検出失敗時のみ | `position: fixed` の全画面オーバーレイ |

#### インライン表示の動作

1. コンテナ内の既存の子要素を `display: none` で隠す
2. 新しい `div.md-viewer-inline` を追加してレンダリング結果を表示
3. 「元に戻す」クリック時に元の子要素の表示を復元

### 3.6 エラーハンドリング

| 状況 | 表示メッセージ |
|---|---|
| DOMからテキスト取得失敗 | 「ファイルの内容を取得できませんでした。Driveプレビューにテキストが表示されていることを確認してください。」 |
| その他のエラー | 「エラーが発生しました: {error.message}」 |

---

## 4. 非機能要件

### 4.1 アーキテクチャ

- **content script のみ** でコア機能を実現（background script はプレースホルダー）
- 外部API呼び出し・ネットワークリクエスト **なし**
- Google認証・OAuthトークン **不要**

### 4.2 セキュリティ

- DOMPurify によるHTMLサニタイズ必須
- 最小権限の原則: `activeTab` + `host_permissions: drive.google.com` のみ

### 4.3 UX

- フェードイン/アウトアニメーション（CSS transition 0.3s）
- ローディングスピナー表示
- ESCキーで閉じる（オーバーレイモード時）
- ダークテーマベース（`#1a1a2e` 背景、`#8ab4f8` アクセント）

### 4.4 DOM監視

- `MutationObserver` でツールバーの出現を監視
- 30秒のタイムアウトで監視を自動停止

---

## 5. 技術スタック

| 要素 | 技術 |
|---|---|
| 拡張規格 | Chrome Extension Manifest V3 |
| Markdown パーサー | marked.js（バンドル済） |
| サニタイザー | DOMPurify（バンドル済） |
| スタイリング | Vanilla CSS（content.css） |
| DOM 操作 | Vanilla JavaScript |

---

## 6. ファイル構成

```
DriveMarkdownViewer/
├── manifest.json          # 拡張設定
├── content.js             # メインロジック（content script）
├── content.css            # スタイルシート
├── background.js          # プレースホルダー（未使用）
├── icons/                 # 拡張アイコン
└── lib/
    ├── marked.min.js      # Markdown パーサー
    └── purify.min.js      # HTML サニタイザー
```

---

## 7. 既知の制約事項

| 制約 | 理由 |
|---|---|
| Driveプレビューにテキストが表示されないファイルでは動作しない | DOM取得方式のため、Driveがプレビューを生成しない大容量ファイル等は対象外 |
| Googleがプレビュー画面のDOM構造を変更すると壊れる可能性がある | CSSセレクタがハードコードされているため |
| シンタックスハイライト非対応 | highlight.js 等のライブラリが未統合 |
| 画像参照は相対パスの場合表示不可 | Drive上の画像は直接URLで参照する必要がある |
