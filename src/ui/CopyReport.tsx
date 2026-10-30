'use client';

// "Copy for Claude": puts a text report of the hand (result, your decisions next to the analyzer's, and a
// replay code) on the clipboard, to paste into a chat. Falls back to a selectable box if copying is blocked.

import { useState } from 'react';
import { ReportInput, roundReport } from '../analyzer';

export function CopyReport({ input, small }: { input: ReportInput; small?: boolean }) {
  const [state, setState] = useState<'idle' | 'copied' | 'manual'>('idle');
  const [text, setText] = useState('');

  const copy = () => {
    // Built inside the tap: Safari only allows clipboard writes directly from a user action.
    const t = roundReport(input);
    setText(t);
    if (!navigator.clipboard) {
      setState('manual');
      return;
    }
    navigator.clipboard.writeText(t).then(
      () => { setState('copied'); setTimeout(() => setState('idle'), 2500); },
      () => setState('manual'),
    );
  };

  return (
    <>
      <button type="button" className={`btn${small ? ' small' : ''}`} onClick={copy}>
        {state === 'copied' ? 'Copied ✓' : 'Copy for Claude'}
      </button>
      {state === 'manual' && (
        <div className="copy-box">
          <p className="note">Copying was blocked; select this text and copy it:</p>
          <textarea readOnly value={text} rows={8} onFocus={(e) => e.currentTarget.select()} />
          <button type="button" className="btn small quiet" onClick={() => setState('idle')}>Close</button>
        </div>
      )}
    </>
  );
}
