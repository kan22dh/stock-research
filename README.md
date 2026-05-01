# Stock Research Dashboard

個別株リサーチ・ダッシュボード。J-Quants API（v2）と FRED API を組み合わせ、
**マクロ環境 → 業界 → 個別銘柄 → AI判断** の4層トップダウン投資判断を支援する。

特に **時価総額が小さい中小型成長株（TOPIX Small 1/2）** から、
**1〜2年で2-3倍を狙える候補銘柄を発掘する**スクリーナーが核となる機能。

## 機能一覧

| ページ | URL | 説明 |
|--------|-----|------|
| 銘柄検索 / ホーム | `/` | コード・銘柄名検索、マクロスナップショット、閲覧履歴、ウォッチリスト |
| 個別銘柄ダッシュボード | `/stocks/[code]` | ローソク足（MA20/MA50・RSI・3M/6M/1Y切替）、出来高、自動診断タグ、AI分析、PER/PBR/ROE、**業界内比較表（自社+同業他社）**、**会社予想（売上/純利益/EPS+YoY）**、6年業績推移、**より成長性高い小型株の発掘候補**、同業他社 |
| ウォッチリスト | `/watchlist` | 株価・1ヶ月リターン・売上YoY・予想売上YoYを並べて表示 |
| **スクリーナー** | `/screener` | TOPIX Small 1/2 から **売上YoY・利益YoY・予想売上YoY** で成長株を絞り込み、CSV出力可 |
| 銘柄比較 | `/compare?codes=72030,94320` | 2銘柄を並べて比較 + AI比較分析 |
| 業界分析 | `/sectors` | 東証33業種別の成長率ランキング、トップグロワー表示 |
| マクロ環境 | `/macro` | 米FF金利・10年米国債・CPI・失業率・USDJPY・WTI原油・米雇用・VIX |

## セットアップ

### 1. 依存インストール

```bash
npm install
```

### 2. 環境変数 (.env)

`.env` に以下を設定:

```env
DATABASE_URL="file:./dev.db"

# J-Quants v2 API キー (必須)
# https://jpx-jquants.com/ で取得
JQUANTS_API_KEY="（あなたのキー）"

# Anthropic API キー (任意 - AI分析機能を有効化)
# https://console.anthropic.com/ で取得
ANTHROPIC_API_KEY=""
```

### 3. データベース初期化

```bash
npx prisma migrate dev
```

### 4. 開発サーバー起動

```bash
npm run dev
```

→ http://localhost:3000

## 使い方

### 初回利用フロー

1. `/` でテキトーな銘柄コード（例: `7203`）を入力 → 検索 → 詳細ページへ
   - 初回は J-Quants の上場銘柄一覧（約4000社）が同期される（数秒）
2. 詳細ページでローソク足・財務指標を確認、「☆ ウォッチに追加」
3. `/screener` を開き **「📊 小型株100件の財務データを取得」** を押す（1〜2分）
   - これにより、スクリーナー・業界分析の集計データが揃う
4. `/screener` で「売上YoY 最低」を「20」などに設定 → 高成長候補が抽出される
5. 気になる銘柄を `/stocks/[code]` で深堀り、AI 分析（要 ANTHROPIC_API_KEY）

### 推奨ワークフロー

```
朝: /macro でマクロ環境を確認 (金利・為替・原油)
 ↓
/sectors で好調業種を把握
 ↓
/screener で小型成長株を抽出
 ↓
/stocks/[code] で深堀り、AI分析
 ↓
/watchlist に保存、SBI証券で発注
```

## J-Quants 無料プランの制限

- データは **約12週間遅延**
- 取得可能データは **過去約2年分**
- データ量: 1日10銘柄程度のレートリミットあり

→ 開発初期は無料で十分。本格運用は LITE プラン（¥1,650/月）で当日データに切替可能。

## 技術スタック

- **Next.js 16** (App Router, React 19)
- **TypeScript**
- **Tailwind v4**
- **Prisma 6** + SQLite (ローカルDB)
- **lightweight-charts** (TradingView製のローソク足ライブラリ)
- **@anthropic-ai/sdk** (AI分析)
- **J-Quants API v2** (株価・財務・上場銘柄)
- **FRED API** (米国マクロ指標)

## アーキテクチャ

```
┌──────────────────────────────────────────────┐
│ UI (Next.js Server Components + Client Comp) │
└─────────────────┬────────────────────────────┘
                  │
        ┌─────────┴─────────┐
        ▼                   ▼
  ┌──────────┐       ┌──────────────┐
  │  Prisma  │       │ Server       │
  │ (SQLite) │◀──────│ Actions      │
  └──────────┘       └──────┬───────┘
                            │
                ┌───────────┼─────────────┐
                ▼           ▼             ▼
          J-Quants API  FRED API   Anthropic API
            (v2)       (CSV DL)     (Claude Haiku)
```

データキャッシュ戦略:
- **ListedStock**: 24時間キャッシュ（変化が遅いため）
- **PriceCache**: 6時間キャッシュ（無料プランは12週遅延データなのでさらに長くてもOK）
- **FinancialCache**: 24時間キャッシュ
- **FRED**: Next.js fetch revalidate 6時間

## 今後の拡張候補

- EDINET API 連携で四半期決算の詳細データ
- 配当金カレンダー & 利回り表示
- テクニカル指標（RSI, MACD, ボリンジャーバンド）
- 通知（決算発表前日、テクニカルシグナル発生時）
- TDnet 適時開示の自動取得・要約
- ポートフォリオ管理（NISA枠・損益）
- 業種ETF対応

## 投資助言ではありません

このツールはあくまで **データの可視化・調査支援** が目的。
投資判断はご自身の責任でお願いします。
