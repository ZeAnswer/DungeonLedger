import { DAY, HOUR, MINUTE, ROUND, type Duration } from '@hl/engine';
import { inputCls } from '../ui';

const SENTINELS: [string, string][] = [['thisAttack', 'this attack'], ['untilMyNextTurn', 'until my next turn'], ['encounter', 'whole battle'], ['untilRemoved', 'until removed']];
const UNITS: [string, string, number][] = [['rounds', 'N rounds', ROUND], ['minutes', 'N minutes', MINUTE], ['hours', 'N hours', HOUR], ['days', 'N days', DAY]];

/** Durations are seconds (ROUND = 6) or one of four sentinels; the control picks the largest unit that divides evenly. */
export function DurationPicker({ value, onChange }: { value: Duration; onChange: (d: Duration) => void }) {
  const secs = typeof value === 'number' ? value : undefined;
  const unit = secs === undefined ? ROUND : secs % DAY === 0 ? DAY : secs % HOUR === 0 ? HOUR : secs % MINUTE === 0 ? MINUTE : ROUND;
  const count = secs === undefined ? 1 : Math.max(1, Math.round(secs / unit));
  const kind = secs === undefined ? (value as string) : UNITS.find((u) => u[2] === unit)![0];
  return (
    <div className="flex flex-wrap items-center gap-1 text-xs">
      <select
        className={inputCls + ' w-auto py-1.5'}
        value={kind}
        onChange={(e) => {
          const u = UNITS.find((x) => x[0] === e.target.value);
          onChange(u ? count * u[2] : (e.target.value as Duration));
        }}
      >
        {SENTINELS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        {UNITS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </select>
      {secs !== undefined && (
        <input
          className={inputCls + ' w-20'}
          inputMode="numeric"
          value={count}
          onChange={(e) => onChange(Math.max(1, Number(e.target.value) || 1) * unit)}
        />
      )}
      {secs !== undefined && <span className="text-zinc-500">= {secs}s</span>}
    </div>
  );
}
