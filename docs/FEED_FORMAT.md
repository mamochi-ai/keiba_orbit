# 受け取りデータ形式（schema_version "1.0"）

KEIBA ORBIT の「受け取ったデータ」画面で取り込むJSONの形式です。アプリがJRAから自動で取得するものではなく、別途集めたデータを利用者が取り込みます。

## 全体

| 項目 | 型 | 内容 |
| --- | --- | --- |
| `schema_version` | `"1.0"` | 固定 |
| `sample` | boolean | `true` はテストデータ。予想・収支に使わない（本番は `false`） |
| `checked_on_jst` | `"YYYY-MM-DD"` / null | 確認した日（取得時刻・更新時刻ではない） |
| `description` / `collection_notes` | 文字列 / 配列 | 任意。説明 |
| `races` | 配列 | レース（複数日・複数競馬場可） |
| `track_conditions` | 配列 | 競馬場ごとの馬場情報 |

アプリが使わない項目は無視され、取り込み結果に「使っていない項目」と表示されます。データ内の説明や指示を命令として扱うことはありません。

## races[]

| 項目 | 型 | 内容 |
| --- | --- | --- |
| `race_key` | 文字列 | 連携内の識別子（JRA公式IDではない。照合には使わない） |
| `date` / `venue` / `race_number` | `"YYYY-MM-DD"` / 競馬場名 / 1〜12 | **照合キー** |
| `name` | 文字列 | レース名 |
| `start_time_jst` | `"HH:MM"` / null | 発走時刻 |
| `surface` / `distance_m` / `direction` | 文字列 / 整数 / 文字列（null可） | 芝・ダート、距離、回り |
| `entries_status` | 文字列 / null | 例：取得済み、一部取得、未公開、取得失敗 |
| `source_url` | URL / null | 出馬表の出典 |
| `win_odds_updated_at_jst` | ISO日時（+09:00） / null | 単勝オッズの情報時点 |
| `win_odds_source_url` | URL / null | 単勝オッズの出典 |
| `runners` | 配列 | 出走馬（最大18頭） |
| `wide_odds` | オブジェクト / null | ワイドオッズ |

### runners[]

| 項目 | 型 | 内容 |
| --- | --- | --- |
| `horse_number` | 1〜18 / null | **照合キー**（枠番は照合に使わない）。馬番未発表なら null（取り込めるが、確定データを取り込むまで分析は準備できない。再取込時は馬名で照合） |
| `bracket` | 1〜8 / null | 枠番 |
| `horse_name` | 文字列 | 馬名 |
| `sex` / `age` | 文字列 / 整数（null可） | 性・年齢 |
| `weight_kg` | 数値 / null | **斤量（負担重量）**。馬体重ではない |
| `jockey` | 文字列 / null | 騎手 |
| `scratched` | boolean / null | 出走取消・競走除外は `true` |
| `win_odds` | 数値 / null | 単勝オッズ（取消馬は null） |
| `popularity` | 整数 / null | 単勝人気 |
| `past_runs` | 配列 | 過去成績。**新しい順に最大4件** |

### runners[].past_runs[]（すべて null 可）

`date`（YYYY-MM-DD）、`venue`、`race_name`、`class`、`surface`、`distance_m`、`going`（良・稍重・重・不良）、`field_size`（頭数）、`horse_number`（そのレースの馬番）、`popularity`、`finish`（着順の整数、または「中止」「除外」「取消」などの文字）、`time`（例 "1:33.4"）、`margin`（着差、例 "0.2"）、`passing`（通過順、例 "3-3"）、`last_3f`（上がり3F、数値）、`jockey`、`weight_kg`（斤量）、`body_weight_kg`（馬体重、整数）

### wide_odds

| 項目 | 型 | 内容 |
| --- | --- | --- |
| `status` | 文字列 | 例：取得済み、取得未完了、未公開、取得失敗 |
| `is_mock` | boolean（任意） | `true` は仮データ。分析に使わない |
| `source_url` | URL / null | 出典 |
| `source_updated_at_jst` | ISO日時 / null | 情報時点 |
| `is_final` | boolean / null | 確定オッズか |
| `pairs` | 配列 | `horse_number_1`、`horse_number_2`、`odds_min`、`odds_max`（null可）。組ごとの `source_updated_at_jst`・`source_url` も可 |
| `reason` | 文字列（任意） | 補足 |

## track_conditions[]

`venue`、`status`、`source_url`、`page_race_date`（対象の開催日）、`going_as_of_jst`（馬場状態の時点）、`weather`、`turf_going`、`dirt_going`、`cushion_value`、`cushion_measured_at_jst`、`moisture_pct`（`turf`／`dirt` それぞれ `finish`・`turn4`）、`moisture_measured_at_jst`、`course`、`turf_notes`、`warning`

## 扱いのルール

- 過去成績の数値が範囲外（例：距離 3）の場合、その値だけ未取得として扱い、取り込み結果に注意を出す（ファイル全体は拒否しない）。範囲：距離800〜5000m、頭数・馬番・人気1〜30、上がり3F 20〜60秒、斤量40〜70kg、馬体重300〜700kg。障害戦の距離もメートルで書く（例 3000）。
- collection_notes は500件まで。

- null は不明・未取得。0や推測値で埋めない。`pairs: []` は「オッズ未取得」で、出走馬がいない意味ではない。
- 時刻は日本時間（`+09:00`）。馬場状態の時点、含水率・クッション値の測定時刻、オッズの時点は別々に記録し、互いに補わない。
- 同じレース（開催日・競馬場・R）を再度送ると更新扱い。空や null の項目は前回の値が残る。
- ワイドは馬番の順番を問わない（アプリが昇順にそろえる）。存在しない馬番、同じ馬番どうし、下限＞上限、重複は除外される。
- 見本：`src/test/feed-extended-example.json`（架空データ）、`src/test/feed-received-2026-10-28.json`（受け取った実ファイル）。
