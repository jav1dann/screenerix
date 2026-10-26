import { Check } from 'lucide-react';
import { Fragment } from 'react';

const STEPS = ['Choose a plan', 'Payment', 'Status'] as const;

/** 1. Choose a plan → 2. Payment → 3. Status. `current` 3 marks every step done. */
export default function Stepper({ current }: { current: 0 | 1 | 2 | 3 }) {
  return (
    <ol className="bx-steps" aria-label="Checkout progress" data-step={current}>
      {STEPS.map((label, i) => {
        const state = i < current ? 'done' : i === current ? 'active' : 'todo';
        return (
          <Fragment key={label}>
            {i > 0 && <li aria-hidden="true" className="bx-step-line" data-done={i <= current} />}
            <li className="bx-step" data-state={state} aria-current={state === 'active' ? 'step' : undefined}>
              <span className="bx-step-num">{state === 'done' ? <Check size={13} strokeWidth={3} /> : i + 1}</span>
              <span className="bx-step-text">{label}</span>
            </li>
          </Fragment>
        );
      })}
    </ol>
  );
}
