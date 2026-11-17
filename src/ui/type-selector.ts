import type { ExportQuestionType } from '../exams/model';

export const selectableTypes: Array<{
  value: ExportQuestionType;
  label: string;
  description: string;
}> = [
  { value: 'choice', label: '选择题', description: '提取独立选择题并连续编号' },
  { value: 'fill', label: '填空题', description: '提取独立填空题并连续编号' },
  { value: 'reading', label: '英语阅读理解', description: '保留文章并整理所属小题' },
  { value: 'cloze', label: '英语完形填空', description: '保留完形材料并整理空位小题' },
];

export function renderTypeSelector(selected: ExportQuestionType, compact = false): string {
  return `<fieldset class="type-selector${compact ? ' is-compact' : ''}">
    <legend>选择要提取的题型</legend>
    <div class="type-option-grid">
      ${selectableTypes.map((item) => `
        <label class="type-option">
          <input type="radio" name="target-type" value="${item.value}" ${selected === item.value ? 'checked' : ''}/>
          <span><b>${item.label}</b><small>${item.description}</small></span>
        </label>`).join('')}
    </div>
  </fieldset>`;
}
