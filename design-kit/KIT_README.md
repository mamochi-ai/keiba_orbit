# KEIBA ORBIT 素材・実装指示パック
これは完成アプリではなく、Claude Codeへ渡す素材と実装仕様です。実レース自動取得・予想エンジンは未実装。

## iPadでの使い方
1. ZIPを「ファイル」に保存しタップして展開。
2. Claude Codeの対象プロジェクトにZIP（または展開フォルダ）を渡す。添付非対応の場合はGitHub/Codespacesのファイルアップロードで配置。
3. CLAUDE_CODE_PROMPT.md全文をClaude Codeに貼る。
4. 「このフォルダの素材を使って実装してください」と依頼。
5. 実装後のプレビューURLをSafariで開く。
preview.htmlは制作用静的見本。iOSのファイルプレビューでCSS/画像が読み込めない場合はClaude Codeのプレビュー環境で確認。ユーザー側でターミナルを使う必要はありません。

## 内容
- CLAUDE_CODE_PROMPT.md: 実装指示
- DESIGN_SPEC.md: デザインと状態仕様
- preview.html: ホーム・分析準備・レポート・部品の静的見本
- assets/orbit-hero.png: 生成背景（不透明）
- assets/orbit-mark.svg / report-grid.svg / empty-orbit.svg: 透過ベクター
- assets/icons/: 透過SVG16種
- assets/orbit-ui.css: ボタン・入力・カード・予算・状態・印刷・レスポンシブ
- templates/: 分析指示、note記事指示、指定の末尾文
- sample-race.json: 入力形式見本（架空デモ、必要データ欠損）

ボタンや文字は画像ではなくCSS/HTMLで作るため、画面サイズや文言変更でも鮮明です。SVGは透過背景。画像生成背景はホームと表紙に使用し、本文は暗い単色にします。

## 制作情報
背景はChatGPT内蔵画像生成で制作。SVG/CSSはコードで作成。第三者の競馬写真や商標素材は未使用。データ取得元の許諾やAPI接続は実装時に別途確認が必要。
背景生成指示: 濃紺の宇宙船分析室、右側にシアンと紫の薄い軌道状ホログラム、左60%は暗い余白、文字・ボタン・馬・人物なし、1536×1024。
