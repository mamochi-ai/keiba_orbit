// Step-by-step manual copy instructions for iPad / iPhone Safari. Shown on the prep screen
// (inside the 出馬表 import panel) and on the settings screen.

export type GuideTopic = 'card' | 'track' | 'wide' | 'claude';

const TITLES: Record<GuideTopic, string> = {
  card: '出馬表（出走表・単勝オッズ・過去成績）',
  track: '馬場',
  wide: 'ワイドのオッズ（ワイドを使うときだけ）',
  claude: 'Claudeとのやり取り',
};

function Steps({ topic }: { topic: GuideTopic }) {
  switch (topic) {
    case 'card':
      return (
        <>
          <ol className="guide-steps">
            <li>Safariで JRA公式サイト（jra.go.jp）を開き、「競馬メニュー」→「出馬表」→ 開催日と競馬場 → 分析するレースを選ぶ。</li>
            <li>
              ページの文字を選択してコピーする。
              <ul>
                <li>
                  <b>キーボードがある場合</b>：ページの何もない所をタップ → <kbd>⌘</kbd>+<kbd>A</kbd>（全選択）→ <kbd>⌘</kbd>+<kbd>C</kbd>（コピー）。
                </li>
                <li>
                  <b>指で操作する場合</b>：見出しの「出馬表 2026年…」の文字を長押し → 青い選択範囲が出たら、下側のつまみ（●）を最後の馬の行まで下へドラッグ（画面の下端で止めると自動でスクロールします）→ 指を離して、出てきたメニューの「コピー」をタップ。
                </li>
              </ul>
            </li>
            <li>KEIBA ORBIT の「分析準備」→「出馬表を貼り付けて自動入力」の入力欄を長押し →「ペースト」。</li>
            <li>
              出典としてURLも残す場合：Safariのアドレスバーをタップ → URLを長押し →「コピー」→ アプリの「ページのURL」欄にペースト。
            </li>
            <li>「読み取る」→ 馬番・馬名・単勝オッズ・取消を確認 →「この内容で反映」。</li>
          </ol>
          <p className="hint">
            見出し（開催日・競馬場・R）から最後の馬まで入っていれば十分です。メニューなど余分な文字が混ざっても構いません。単勝オッズはコピーした時点の値なので、「オッズの対象時点」はコピーした時刻にしてください。
          </p>
          <p className="hint">読み取れない場合は、出走表の欄に「馬番 馬名」を1行ずつ手入力できます（取消は行末に「取消」）。</p>
        </>
      );
    case 'track':
      return (
        <ol className="guide-steps">
          <li>JRA公式サイトの「競馬メニュー」→「馬場情報」を開く。</li>
          <li>該当する競馬場の部分（芝・ダートの状態、含水率、クッション値など）を長押しで選択 →「コピー」。</li>
          <li>アプリの「馬場」を開いて内容欄にペースト → 提供者に「JRA公式サイト（馬場情報）」、取得日時と対象時点（発表時刻）を入れて「この内容で反映」。</li>
        </ol>
      );
    case 'wide':
      return (
        <ol className="guide-steps">
          <li>JRA公式サイトの「競馬メニュー」→「オッズ」→ レースを選び、ワイドのオッズを表示する。</li>
          <li>
            アプリの「オッズ」の内容欄に、使う組み合わせだけを1行ずつ入力：<code>4-7 2.1-2.8</code>（馬番-馬番 最低-最高）。単勝は <code>4 3.2</code> の形です。
          </li>
          <li>「対象時点」に、オッズを見た時刻を入れて「この内容で反映」。</li>
        </ol>
      );
    case 'claude':
      return (
        <ol className="guide-steps">
          <li>「分析対象と情報締切を確認しました」にチェック →「分析用コピー」。</li>
          <li>「Claudeを開く」→ 新しいチャットの入力欄を長押し →「ペースト」→ 送信。参考画像があれば、ここで一緒に添付。</li>
          <li>Claudeの返答が出たら、返答の下のコピーボタンでコピー（JSONだけが返っていればそのままでOK）。</li>
          <li>アプリに戻り「結果を貼り付け」→ 入力欄にペースト →「読み込んで確認」→ 内容を確認して保存。</li>
          <li>記事にするときは、レポートの「note記事作成用コピー」→ Claudeに貼り付け → できた記事を「生成された記事を貼り戻す」に保存。</li>
        </ol>
      );
  }
}

export function CopyGuide({ topics, open = false }: { topics: GuideTopic[]; open?: boolean }) {
  return (
    <div className="guide">
      {topics.map((t) => (
        <details key={t} className="subgroup" open={open}>
          <summary>コピーの手順：{TITLES[t]}</summary>
          <Steps topic={t} />
        </details>
      ))}
    </div>
  );
}
