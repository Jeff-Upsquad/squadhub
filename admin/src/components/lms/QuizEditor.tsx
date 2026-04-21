'use client';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../services/api';
import type { LmsQuizQuestion } from '@squadhub/shared';

interface Props {
  blockId: string;
  questions: LmsQuizQuestion[];
  itemId: string;
}

export default function QuizEditor({ blockId, questions, itemId }: Props) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<null | Partial<LmsQuizQuestion>>(null);

  const createQuestion = useMutation({
    mutationFn: (body: any) => api.post(`/admin/lms/blocks/${blockId}/quiz-questions`, body).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lms-item', itemId] });
      setDraft(null);
    },
    onError: (e: any) => alert(e?.response?.data?.error || 'Failed to save'),
  });

  const updateQuestion = useMutation({
    mutationFn: ({ id, ...body }: any) => api.patch(`/admin/lms/quiz-questions/${id}`, body).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lms-item', itemId] }),
  });

  const deleteQuestion = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/lms/quiz-questions/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lms-item', itemId] }),
  });

  return (
    <div className="space-y-3">
      {questions.map((q, i) => (
        <QuestionRow
          key={q.id}
          index={i}
          question={q}
          onSave={(patch) => updateQuestion.mutate({ id: q.id, ...patch })}
          onDelete={() => {
            if (confirm('Delete this question?')) deleteQuestion.mutate(q.id);
          }}
        />
      ))}

      {draft && (
        <QuestionDraft
          draft={draft}
          setDraft={setDraft}
          onCancel={() => setDraft(null)}
          onSave={() => {
            if (!draft.prompt || !draft.options || !draft.correct_option_id) {
              alert('Fill in question, options, and correct answer');
              return;
            }
            createQuestion.mutate({
              prompt: draft.prompt,
              options: draft.options,
              correct_option_id: draft.correct_option_id,
              explanation: draft.explanation ?? null,
            });
          }}
        />
      )}

      {!draft && (
        <button
          type="button"
          onClick={() => setDraft({
            prompt: '',
            options: [{ id: 'a', text: '' }, { id: 'b', text: '' }],
            correct_option_id: 'a',
          })}
          className="w-full rounded-md border border-dashed border-[#CBD5E1] bg-white py-2 text-sm text-[#62748E] hover:border-[#0F172B] hover:text-[#0F172B]"
        >
          + Add question
        </button>
      )}
    </div>
  );
}

function QuestionRow({ index, question, onSave, onDelete }: {
  index: number;
  question: LmsQuizQuestion;
  onSave: (patch: any) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Partial<LmsQuizQuestion>>(question);

  if (!editing) {
    return (
      <div className="rounded-lg border border-[#E2E8F0] bg-white p-3">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-medium text-[#0F172B]">{index + 1}. {question.prompt}</p>
          <div className="flex shrink-0 gap-1">
            <button type="button" onClick={() => { setDraft(question); setEditing(true); }} className="rounded px-2 py-0.5 text-[11px] text-[#62748E] hover:bg-[#F8FAFC]">Edit</button>
            <button type="button" onClick={onDelete} className="rounded px-2 py-0.5 text-[11px] text-red-600 hover:bg-red-50">Delete</button>
          </div>
        </div>
        <ul className="mt-2 space-y-0.5">
          {question.options.map((opt) => (
            <li key={opt.id} className={`text-[13px] ${opt.id === question.correct_option_id ? 'font-medium text-emerald-700' : 'text-[#62748E]'}`}>
              {opt.id === question.correct_option_id ? '✓ ' : '○ '}{opt.text}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <QuestionDraft
      draft={draft}
      setDraft={setDraft}
      onCancel={() => setEditing(false)}
      onSave={() => {
        onSave({
          prompt: draft.prompt,
          options: draft.options,
          correct_option_id: draft.correct_option_id,
          explanation: draft.explanation ?? null,
        });
        setEditing(false);
      }}
    />
  );
}

function QuestionDraft({ draft, setDraft, onCancel, onSave }: {
  draft: Partial<LmsQuizQuestion>;
  setDraft: (d: any) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const options = draft.options || [];
  return (
    <div className="space-y-2 rounded-lg border border-[#CBD5E1] bg-[#F8FAFC] p-3">
      <input
        type="text"
        value={draft.prompt || ''}
        onChange={(e) => setDraft({ ...draft, prompt: e.target.value })}
        placeholder="Question prompt"
        className="w-full rounded-md border border-[#E2E8F0] bg-white px-3 py-2 text-sm focus:border-[#0F172B] focus:outline-none"
      />
      <div className="space-y-1">
        {options.map((opt: any, i: number) => (
          <div key={opt.id} className="flex items-center gap-2">
            <input
              type="radio"
              name="correct"
              checked={draft.correct_option_id === opt.id}
              onChange={() => setDraft({ ...draft, correct_option_id: opt.id })}
              className="h-4 w-4"
            />
            <input
              type="text"
              value={opt.text}
              onChange={(e) => {
                const next = [...options];
                next[i] = { ...opt, text: e.target.value };
                setDraft({ ...draft, options: next });
              }}
              placeholder={`Option ${i + 1}`}
              className="flex-1 rounded-md border border-[#E2E8F0] bg-white px-3 py-1.5 text-sm focus:border-[#0F172B] focus:outline-none"
            />
            {options.length > 2 && (
              <button
                type="button"
                onClick={() => {
                  const next = options.filter((_: any, j: number) => j !== i);
                  const correctId = draft.correct_option_id;
                  const newCorrect = next.some((o: any) => o.id === correctId) ? correctId : next[0]?.id;
                  setDraft({ ...draft, options: next, correct_option_id: newCorrect });
                }}
                className="text-[#90A1B9] hover:text-red-600"
              >
                ×
              </button>
            )}
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={() => {
          const nextId = String.fromCharCode(97 + options.length);
          setDraft({ ...draft, options: [...options, { id: nextId, text: '' }] });
        }}
        className="text-[12px] text-[#62748E] hover:text-[#0F172B]"
      >
        + Add option
      </button>
      <textarea
        value={draft.explanation || ''}
        onChange={(e) => setDraft({ ...draft, explanation: e.target.value })}
        placeholder="Explanation (shown after submit)"
        rows={2}
        className="w-full rounded-md border border-[#E2E8F0] bg-white px-3 py-2 text-sm focus:border-[#0F172B] focus:outline-none"
      />
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-md border border-[#E2E8F0] bg-white px-3 py-1.5 text-[12px] text-[#62748E]">Cancel</button>
        <button type="button" onClick={onSave} className="rounded-md bg-[#0F172B] px-3 py-1.5 text-[12px] font-medium text-white">Save</button>
      </div>
    </div>
  );
}
