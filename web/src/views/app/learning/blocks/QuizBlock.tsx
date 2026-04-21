'use client';
import { useState } from 'react';
import type { LmsContentBlock, LmsQuizQuestion } from '@squadhub/shared';
import { useSubmitQuiz } from '../../../../hooks/useLms';

interface Props {
  block: LmsContentBlock;
  assignmentId: string | null;
}

export default function QuizBlock({ block, assignmentId }: Props) {
  const questions: LmsQuizQuestion[] = block.quiz_questions || [];
  const submit = useSubmitQuiz();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [result, setResult] = useState<null | {
    score_percent: number;
    passed: boolean;
    questions: Record<string, { is_correct: boolean; correct_option_id: string; explanation: string | null }>;
  }>(null);

  if (questions.length === 0) {
    return (
      <div className="my-2 rounded-lg border border-dashed border-[var(--sh-hair)] bg-[var(--surface)] px-4 py-6 text-center text-[13px] text-[var(--sh-ink-3)]">
        Quiz has no questions yet
      </div>
    );
  }

  const canSubmit = questions.every((q) => answers[q.id]);

  async function onSubmit() {
    if (!assignmentId || !canSubmit || submit.isPending) return;
    const res = await submit.mutateAsync({ assignmentId, blockId: block.id, answers });
    if (res?.data) setResult(res.data);
  }

  return (
    <div className="my-3 rounded-xl border border-[var(--sh-hair)] bg-[var(--surface)] p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="grid h-6 w-6 place-items-center rounded-full bg-[var(--sh-hair-3)] text-[12px] font-semibold text-[var(--sh-ink-2)]">?</span>
        <p className="text-[13px] font-semibold text-[var(--sh-ink)]">Knowledge check</p>
        {result && (
          <span className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-medium ${
            result.passed ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
          }`}>
            {result.score_percent}% {result.passed ? '— Passed' : '— Try again'}
          </span>
        )}
      </div>

      <div className="space-y-4">
        {questions.map((q, i) => {
          const given = answers[q.id];
          const feedback = result?.questions[q.id];
          return (
            <div key={q.id}>
              <p className="mb-2 text-sm font-medium text-[var(--sh-ink)]">{i + 1}. {q.prompt}</p>
              <div className="space-y-1.5">
                {q.options.map((opt) => {
                  const selected = given === opt.id;
                  let state: 'neutral' | 'correct' | 'incorrect' = 'neutral';
                  if (feedback) {
                    if (opt.id === feedback.correct_option_id) state = 'correct';
                    else if (selected && !feedback.is_correct) state = 'incorrect';
                  }
                  return (
                    <label
                      key={opt.id}
                      className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm transition ${
                        state === 'correct' ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                        : state === 'incorrect' ? 'border-red-300 bg-red-50 text-red-800'
                        : selected ? 'border-[var(--sh-ink)] bg-[var(--sh-hair-3)] text-[var(--sh-ink)]'
                        : 'border-[var(--sh-hair)] text-[var(--sh-ink-2)] hover:border-[var(--sh-ink-3)]'
                      }`}
                    >
                      <input
                        type="radio"
                        name={`q-${q.id}`}
                        value={opt.id}
                        checked={selected}
                        onChange={() => !result && setAnswers((prev) => ({ ...prev, [q.id]: opt.id }))}
                        disabled={!!result}
                        className="h-4 w-4"
                      />
                      <span>{opt.text}</span>
                    </label>
                  );
                })}
              </div>
              {feedback?.explanation && (
                <p className="mt-1.5 rounded-md bg-[var(--sh-hair-3)] px-3 py-2 text-[12px] text-[var(--sh-ink-2)]">
                  {feedback.explanation}
                </p>
              )}
            </div>
          );
        })}
      </div>

      {!result ? (
        <button
          onClick={onSubmit}
          disabled={!canSubmit || submit.isPending}
          className="mt-4 rounded-md bg-[var(--sh-ink)] px-4 py-2 text-sm font-medium text-[var(--sidebar)] disabled:opacity-50"
        >
          {submit.isPending ? 'Submitting…' : 'Submit answers'}
        </button>
      ) : (
        <button
          onClick={() => { setResult(null); setAnswers({}); }}
          className="mt-4 rounded-md border border-[var(--sh-hair)] bg-[var(--surface)] px-4 py-2 text-sm text-[var(--sh-ink-2)] hover:bg-[var(--sh-hair-3)]"
        >
          Try again
        </button>
      )}
    </div>
  );
}
