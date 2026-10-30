'use client';

// End of round: who won and how, the fan breakdown and every payment (fan payout, fei, loser settlement).

import { ReportInput } from '../analyzer';
import { CAP, RoundResult } from '../engine';
import { CopyReport } from './CopyReport';
import { rmShort } from './format';

export function ResultPanel({ result, names, report, onReview, onNext }: {
  result: RoundResult;
  report: ReportInput;
  names: string[];
  onReview: () => void;
  onNext?: () => void;
}) {
  const r = result;
  const headline = r.type === 'draw'
    ? 'The wall ran out: a draw. Only fei (joker) money is settled.'
    : `${r.winner === 0 ? 'You' : names[r.winner!]} won with ${r.score!.fan} fan${r.payment === 'self' ? ', self-drawn' : ` off ${r.payer === 0 ? 'your' : `${names[r.payer!]}'s`} ${r.score!.items.some((i) => i.key === 'stealKong') ? 'kong' : 'discard'}`}.`;
  const rows: [string, number[]][] = [['Fan payout', r.fanPayout], ['Fei (jokers)', r.fei], ['Loser settlement', r.loser]];

  return (
    <div className="panel result" role="dialog" aria-label="Round result">
      <p className="lead">{headline}</p>
      {r.score && (
        <ul className="fan-items">
          {r.score.items.map((it, i) => <li key={i}><span>{it.label}</span><span>{it.fan}</span></li>)}
          <li className="total">
            <span>Total{r.score.rawFan > CAP ? ` (${r.score.rawFan}, capped at ${CAP})` : ''}</span><span>{r.score.fan}</span>
          </li>
        </ul>
      )}
      <table className="money-table">
        <thead>
          <tr><th></th>{names.map((n) => <th key={n}>{n}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map(([label, d]) => (
            <tr key={label}><th>{label}</th>{d.map((x, p) => <td key={p}>{x ? rmShort(x) : '–'}</td>)}</tr>
          ))}
          <tr className="total"><th>This round</th>{r.total.map((x, p) => <td key={p}>{rmShort(x)}</td>)}</tr>
        </tbody>
      </table>
      {r.loserFans && (
        <p className="note">
          Loser settlement fan: {r.loserFans.map((l, p) => (p === r.winner ? null : `${names[p]} ${l.fan}`)).filter(Boolean).join(', ')}
          {' '}(5+ collects; a 10-fan win cancels it).
        </p>
      )}
      <p className="note">Jokers held: {r.jokers.map((j, p) => `${names[p]} ${j}`).join(', ')}.</p>
      <div className="actions">
        <button type="button" className="btn" onClick={onReview}>Review my play</button>
        <CopyReport input={report} />
        {onNext && <button type="button" className="btn primary" onClick={onNext}>Next round</button>}
      </div>
    </div>
  );
}
