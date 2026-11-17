import type { ClassifiedQuestion, QuestionGroup } from '../exams/model';

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function renderGroupView(options: {
  group: QuestionGroup;
  groupIndex: number;
  questions: ClassifiedQuestion[];
  renderMaterial: () => string;
  renderQuestion: (question: ClassifiedQuestion) => string;
}): string {
  const { group, groupIndex, questions, renderMaterial, renderQuestion } = options;
  const label = group.type === 'reading' ? '阅读' : '完形';
  return `<article class="passage-card" data-group-id="${escapeHtml(group.id)}">
    <header class="passage-head">
      <div><span>${label} ${groupIndex + 1}</span>${group.originalLabel ? `<small>${escapeHtml(group.originalLabel)}</small>` : ''}</div>
      <b>${questions.length} 个小题</b>
    </header>
    <section class="passage-material">
      <div class="passage-label">文章材料</div>
      ${renderMaterial()}
    </section>
    <div class="passage-question-list">${questions.map(renderQuestion).join('')}</div>
  </article>`;
}
