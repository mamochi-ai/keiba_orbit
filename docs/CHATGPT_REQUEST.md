# データ収集の依頼文（ChatGPTに貼り付ける用）

以下を、そのまま収集担当のChatGPTに送ってください。

---

KEIBA ORBIT（受け取る側のアプリ）を、過去成績・単勝オッズ・出走取消も読めるように更新しました。今後の収集結果は、次の形式でJSONにしてください。schema_version は "1.0" のままです。

【これまでと同じ部分】
- 全体：schema_version、sample、checked_on_jst、races、track_conditions（description、collection_notes は任意）
- 本番データは sample: false。テスト用だけ sample: true。
- レースは date・venue・race_number で照合されます。race_key は自由な識別子で構いません。
- runners の照合キーは horse_number です。bracket（枠番）と混同しないでください。
- weight_kg は斤量（負担重量）です。馬体重ではありません。
- wide_odds は status、is_mock、source_url、source_updated_at_jst、is_final、pairs（horse_number_1、horse_number_2、odds_min、odds_max）。組ごとに source_updated_at_jst、source_url を付けても構いません。
- track_conditions はこれまでの項目のままです（going_as_of_jst と moisture_measured_at_jst などの時刻は別々に）。

【追加してほしい項目】
1. 各レースに
   - "win_odds_updated_at_jst"：単勝オッズを確認したページの時点（例 "2026-10-31T20:55:00+09:00"）。分からなければ null。
   - "win_odds_source_url"：単勝オッズの出典URL。
2. 各出走馬（runners の各要素）に
   - "scratched"：出走取消・競走除外なら true、出走予定なら false、不明なら null。
   - "win_odds"：単勝オッズ（数値）。取消馬や未取得は null。
   - "popularity"：単勝人気（整数）。未取得は null。
   - "past_runs"：過去成績の配列。新しい順に最大4件。1件の形式は次のとおりです。

{
  "date": "2026-09-28",
  "venue": "中山",
  "race_name": "○○特別",
  "class": "3勝クラス",
  "surface": "芝",
  "distance_m": 1600,
  "going": "良",
  "field_size": 16,
  "horse_number": 3,
  "popularity": 2,
  "finish": 1,
  "time": "1:33.4",
  "margin": "0.2",
  "passing": "3-3",
  "last_3f": 33.8,
  "jockey": "騎手名",
  "weight_kg": 57,
  "body_weight_kg": 478
}

   - finish は着順の整数。競走中止・除外・取消は "中止"、"除外"、"取消" の文字で。
   - weight_kg は斤量、body_weight_kg は馬体重（整数）です。混同しないでください。
   - 分からない項目は null。初出走なら past_runs は []。

【守ってほしいこと】
- 取得できなかった値は null にして、推測や仮データで埋めないでください。仮の値を入れる場合は wide_odds.is_mock: true にし、sample: true のファイルにしてください。
- 時刻はすべて日本時間（+09:00）で、その値を確認した時点を書いてください。確認日（checked_on_jst）とは別です。
- 金曜・土曜の夜に取るオッズは前日時点の値です。その時点を正確に書いてください（最終オッズではありません）。
- 出馬表が未公開のレースは、runners を [] にし、entries_status に「未公開」と書いてください。取得に失敗した場合は「取得失敗」、一部だけなら「一部取得」と書いてください。
- 同じレースを後で取り直したときは、同じ date・venue・race_number で送れば更新されます。取れなかった項目は null のままで構いません（前回の値が残ります）。
- JSON以外の説明は collection_notes に入れてください。

---
