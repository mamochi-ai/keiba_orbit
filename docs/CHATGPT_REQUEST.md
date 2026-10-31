# データ収集の依頼文（ChatGPTに貼り付ける用）

以下を、そのまま収集担当のChatGPTに送ってください。形式の詳細は docs/FEED_FORMAT.md にあります。

---

KEIBA ORBIT（受け取る側のアプリ）を更新しました。これまでの形式（schema_version "1.0"）はそのままで、次の項目と収集のタイミングを追加してください。

【追加する項目】
1. 各出走馬（runners の各要素）に、JRA公式の出馬表から
   - "sire"：父、"dam"：母、"dam_sire"：母の父
   - "trainer"：調教師名、"trainer_affiliation"：所属（「美浦」「栗東」など）
   - "body_weight_kg"：当日の馬体重（整数）。発表前は null。
   - "body_weight_diff_kg"：前走からの増減（整数。+4 は 4、-6 は -6、増減なしは 0）。発表前・初出走で不明なら null。
   ※ weight_kg は斤量（負担重量）、body_weight_kg は馬体重です。混同しないでください。
2. 各レースに
   - "body_weight_announced_at_jst"：馬体重を確認したページの時点（例 "2026-11-01T14:40:00+09:00"）。不明なら null。
   - "result"：レース後の公式結果。レース前は null。形式は次のとおり。

"result": {
  "status": "確定",
  "confirmed_at_jst": "2026-11-01T15:52:00+09:00",
  "source_url": "https://www.jra.go.jp/...",
  "finish_order": [
    { "horse_number": 5, "finish": 1 },
    { "horse_number": 7, "finish": 2 },
    { "horse_number": 3, "finish": "取消" }
  ],
  "payouts": {
    "win": [ { "horse_number": 5, "yen": 230 } ],
    "wide": [ { "horse_number_1": 5, "horse_number_2": 7, "yen": 360 } ]
  }
}

   - yen は100円あたりの払戻金。同着で複数ある場合は全部入れてください。
   - 払戻金がまだ取れていなければ "payouts": null。

【収集のタイミング】
- 前日の夜（金曜・土曜 21時ごろ）：翌日分の出馬表・過去成績・前日オッズ・前日の馬場（これまでどおり）。
- レース当日の朝（土曜・日曜 9時台）：その日の全レースについて、当日の馬場（馬場状態・クッション値・含水率とそれぞれの時点）、最新の単勝・ワイドオッズとその時点、出走取消・競走除外・騎手変更。前日に馬番が未発表だったレースは、確定した馬番も。
- レース当日の夜（土曜・日曜 21時ごろ）：その日の全レースの result（着順と単勝・ワイドの払戻金）と、当日の馬体重（body_weight_kg・body_weight_diff_kg）。
- 同じレースは同じ date・venue・race_number で送れば更新されます。取れなかった項目は null のままで構いません（前回の値が残ります）。

【守ってほしいこと（これまでと同じ）】
- 取得できなかった値は null。推測や仮データで埋めない。
- 時刻は日本時間（+09:00）で、その値を確認したページの時点を書く。確認日（checked_on_jst）とは別。
- 本番データは sample: false。
- JSON以外の説明は collection_notes に入れる。

---
