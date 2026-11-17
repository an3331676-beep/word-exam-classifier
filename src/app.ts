import { mergeWithNext, promoteReviewRange, splitQuestion, updateQuestionType } from './exams/editor';
import { exportCategoryDocx, type ExportedDocx } from './exams/export-docx';
import { importBatch } from './exams/import-batch';
import type {
  BatchResult,
  ClassifiedQuestion,
  DocumentResource,
  ParsedExam,
  QuestionType,
  UploadLike,
} from './exams/model';

type FilterType = QuestionType | 'all';
type ExportType = Exclude<QuestionType, 'unknown'>;

interface AppServices {
  importDocuments(files: UploadLike[]): Promise<BatchResult>;
  exportCategory(
    type: ExportType,
    questions: ClassifiedQuestion[],
    exams: ParsedExam[],
  ): Promise<ExportedDocx>;
  download(blob: Blob, fileName: string): void;
  print(): void;
}

const TYPE_LABELS: Record<QuestionType, string> = {
  choice: '选择题',
  fill: '填空题',
  solution: '解答题',
  reading: '英语阅读理解',
  cloze: '英语完形填空',
  unknown: '待定',
};

const defaultServices: AppServices = {
  importDocuments: importBatch,
  exportCategory: exportCategoryDocx,
  download(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
  },
  print() {
    window.print();
  },
};

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function bytesToBlob(resource: DocumentResource): Blob {
  const buffer = resource.bytes.buffer.slice(
    resource.bytes.byteOffset,
    resource.bytes.byteOffset + resource.bytes.byteLength,
  ) as ArrayBuffer;
  return new Blob([buffer], { type: resource.contentType });
}

export function createExamApp(root: HTMLElement, overrides: Partial<AppServices> = {}) {
  const services = { ...defaultServices, ...overrides };
  let result: BatchResult | undefined;
  let questions: ClassifiedQuestion[] = [];
  let activeFilter: FilterType = 'all';
  let busy = false;
  let status = '';
  let exportMessage = '';
  let printType: ExportType = 'choice';
  const objectUrls = new Map<string, string>();

  const releaseObjectUrls = () => {
    for (const url of objectUrls.values()) URL.revokeObjectURL(url);
    objectUrls.clear();
  };

  const examById = (sourceId: string) => result?.exams.find((exam) => exam.source.id === sourceId);

  const resourceUrl = (sourceId: string, resource: DocumentResource): string => {
    const key = `${sourceId}:${resource.relationshipId}`;
    const existing = objectUrls.get(key);
    if (existing) return existing;
    const url = URL.createObjectURL(bytesToBlob(resource));
    objectUrls.set(key, url);
    return url;
  };

  const renderBlock = (exam: ParsedExam, blockIndex: number, print = false): string => {
    const block = exam.blocks[blockIndex];
    if (!block) return '';
    const images = block.relationshipIds
      .map((id) => exam.resources.get(id))
      .filter((resource): resource is DocumentResource => Boolean(resource?.type.endsWith('/image')))
      .map(
        (resource) =>
          `<img class="question-image" src="${resourceUrl(exam.source.id, resource)}" alt="题目配图" />`,
      )
      .join('');
    const formula = block.hasFormula ? '<span class="content-tag">含 Word 公式</span>' : '';
    const className = block.kind === 'table' ? 'preview-block preview-table' : 'preview-block';
    return `<div class="${className}${print ? ' print-block' : ''}">${
      block.text ? `<p>${escapeHtml(block.text).replaceAll('\n', '<br />')}</p>` : ''
    }${images}${formula}</div>`;
  };

  const renderQuestionBody = (question: ClassifiedQuestion, print = false): string => {
    const exam = examById(question.sourceId);
    if (!exam) return '<p class="empty-copy">来源文档不可用</p>';
    const blocks: string[] = [];
    for (let index = question.startBlock; index < question.endBlock; index += 1) {
      blocks.push(renderBlock(exam, index, print));
    }
    return blocks.join('');
  };

  const counts = () => {
    const byType: Record<QuestionType, number> = {
      choice: 0,
      fill: 0,
      solution: 0,
      reading: 0,
      cloze: 0,
      unknown: 0,
    };
    for (const question of questions) byType[question.type] += 1;
    return byType;
  };

  const renderInitial = () => `
    <section class="hero-card">
      <div class="eyebrow"><span class="eyebrow-dot"></span> 本地文档整理</div>
      <h1>把多份 Word 试卷<br /><span>归成清楚的题型合集</span></h1>
      <p class="hero-copy">一次添加多份可编辑的 .docx。系统先识别题目边界，再按选择题、填空题和解答题整理。所有处理都在当前浏览器中完成。</p>
      <label class="upload-zone ${busy ? 'is-busy' : ''}" for="exam-files">
        <input id="exam-files" type="file" accept=".docx" multiple ${busy ? 'disabled' : ''} />
        <span class="upload-icon" aria-hidden="true">＋</span>
        <span class="upload-copy"><strong>${busy ? '正在分析文档…' : '添加 Word 试卷'}</strong><small>选择多个 .docx，或拖到这里</small></span>
        <span class="upload-action">选择文件</span>
      </label>
      ${status ? `<p class="status-line" role="status">${escapeHtml(status)}</p>` : ''}
      <div class="workflow-strip" aria-label="处理步骤">
        <span><b>01</b> 读取结构</span><i></i><span><b>02</b> 核对边界</span><i></i><span><b>03</b> 分类导出</span>
      </div>
    </section>
    <aside class="privacy-card">
      <div class="privacy-mark">文档<br />留在本机</div>
      <div><h2>试卷不会上传</h2><p>页面直接读取 Word 包内的段落、自动编号、公式和图片。关闭页面后，当前整理结果随之清除。</p></div>
    </aside>
  `;

  const renderSummary = () => {
    const currentCounts = counts();
    const reviewCount = currentCounts.unknown + (result?.reviewItems.length ?? 0);
    return `
      <section class="workspace-head">
        <div>
          <div class="eyebrow"><span class="eyebrow-dot"></span> 已读取 ${result?.exams.length ?? 0} 份试卷</div>
          <h1>分类核对台</h1>
          <p>先看待核对项，再导出题型汇总。</p>
        </div>
        <label class="compact-upload" for="exam-files">
          <input id="exam-files" type="file" accept=".docx" multiple ${busy ? 'disabled' : ''} />
          <span>＋ 重新选择试卷</span>
        </label>
      </section>
      <section class="metric-grid" aria-label="题型统计">
        ${(['choice', 'fill', 'solution', 'unknown'] as QuestionType[])
          .map(
            (type) => `<button class="metric-card metric-${type}" data-filter="${type}" data-count="${type}">
              <span>${TYPE_LABELS[type]}</span><strong>${currentCounts[type]}</strong>
            </button>`,
          )
          .join('')}
        <div class="metric-card review-total"><span>需核对线索</span><strong>${reviewCount}</strong></div>
      </section>
    `;
  };

  const renderFilters = () => `
    <nav class="filter-row" aria-label="题目筛选">
      ${([
        ['all', '全部题目'],
        ['choice', '选择题'],
        ['fill', '填空题'],
        ['solution', '解答题'],
        ['unknown', '待定'],
      ] as Array<[FilterType, string]>)
        .map(
          ([value, label]) =>
            `<button data-filter="${value}" class="${activeFilter === value ? 'is-active' : ''}">${label}</button>`,
        )
        .join('')}
    </nav>
  `;

  const renderQuestionCard = (question: ClassifiedQuestion, globalIndex: number): string => {
    const exam = examById(question.sourceId);
    const splitOptions = Array.from(
      { length: Math.max(0, question.endBlock - question.startBlock - 1) },
      (_, index) => question.startBlock + index + 1,
    );
    const next = questions[globalIndex + 1];
    const canMerge = next?.sourceId === question.sourceId && next.startBlock === question.endBlock;
    return `
      <article class="question-card type-${question.type}" data-question-id="${escapeHtml(question.id)}" data-question-type="${question.type}">
        <header class="question-meta">
          <div>
            <span class="type-chip">${TYPE_LABELS[question.type]}</span>
            <span class="source-chip">${escapeHtml(exam?.source.fileName ?? question.sourceId)}</span>
            <span class="source-chip">原题 ${escapeHtml(question.originalNumber)}</span>
          </div>
          <span class="block-range">段落 ${question.startBlock + 1}—${question.endBlock}</span>
        </header>
        <div class="question-preview">${renderQuestionBody(question)}</div>
        <footer class="question-tools">
          <label>题型
            <select data-action="type" data-id="${escapeHtml(question.id)}">
              ${(['choice', 'fill', 'solution', 'unknown'] as QuestionType[])
                .map((type) => `<option value="${type}" ${question.type === type ? 'selected' : ''}>${TYPE_LABELS[type]}</option>`)
                .join('')}
            </select>
          </label>
          <label>拆分边界
            <select data-action="split-point" data-id="${escapeHtml(question.id)}" ${splitOptions.length ? '' : 'disabled'}>
              ${splitOptions.map((point) => `<option value="${point}">第 ${point + 1} 段前</option>`).join('')}
            </select>
          </label>
          <button data-action="split" data-id="${escapeHtml(question.id)}" ${splitOptions.length ? '' : 'disabled'}>拆成两题</button>
          <button data-action="merge" data-id="${escapeHtml(question.id)}" ${canMerge ? '' : 'disabled'}>与下一题合并</button>
          <p class="reason-line">${escapeHtml(question.reason)}</p>
        </footer>
      </article>
    `;
  };

  const renderReviewItems = () => {
    const items = result?.reviewItems ?? [];
    if (!items.length) return '';
    return `<details class="review-panel" open>
      <summary><span>边界与缺失线索</span><b>${items.length}</b></summary>
      <div class="review-list">
        ${items
          .map((item) => {
            const exam = examById(item.sourceId);
            return `<div class="review-item">
              <div><strong>${escapeHtml(exam?.source.fileName ?? item.sourceId)}</strong><p>${escapeHtml(item.reason)}</p></div>
              <button data-action="promote-review" data-review-id="${escapeHtml(item.id)}">作为一道题加入</button>
            </div>`;
          })
          .join('')}
      </div>
    </details>`;
  };

  const renderErrors = () => {
    const errors = result?.fileErrors ?? [];
    if (!errors.length) return '';
    return `<section class="error-panel"><h2>有 ${errors.length} 个文件未读取</h2>${errors
      .map((error) => `<p><strong>${escapeHtml(error.fileName)}</strong>${escapeHtml(error.message)}</p>`)
      .join('')}</section>`;
  };

  const renderExportPanel = () => `
    <aside class="export-panel">
      <div><span class="eyebrow">输出汇总</span><h2>核对后再生成</h2><p>Word 保留题目内容与来源。PDF 使用浏览器打印功能。</p></div>
      ${(['choice', 'fill', 'solution'] as ExportType[])
        .map(
          (type) => `<div class="export-row"><span><b>${TYPE_LABELS[type]}</b><small>${counts()[type]} 题</small></span><button data-export="${type}" ${counts()[type] ? '' : 'disabled'}>导出 Word</button><button class="ghost-button" data-print="${type}" ${counts()[type] ? '' : 'disabled'}>打印 PDF</button></div>`,
        )
        .join('')}
      ${exportMessage ? `<p class="export-message" role="status">${escapeHtml(exportMessage)}</p>` : ''}
    </aside>
  `;

  const renderPrintSheet = () => {
    const printable = questions.filter((question) => question.type === printType);
    return `<section class="print-sheet">
      <h1>${TYPE_LABELS[printType]}汇总</h1>
      ${printable
        .map((question, index) => {
          const exam = examById(question.sourceId);
          return `<article class="print-question"><h2>${index + 1}. <span>${escapeHtml(
            exam?.source.fileName ?? question.sourceId,
          )} · 原题 ${escapeHtml(question.originalNumber)}</span></h2>${renderQuestionBody(question, true)}</article>`;
        })
        .join('')}
    </section>`;
  };

  const attachFileInput = () => {
    const input = root.querySelector<HTMLInputElement>('#exam-files');
    input?.addEventListener('change', () => {
      void loadFiles(Array.from(input.files ?? []));
    });
    const uploadZone = root.querySelector<HTMLElement>('.upload-zone');
    uploadZone?.addEventListener('dragover', (event) => {
      event.preventDefault();
      uploadZone.classList.add('is-dragging');
    });
    uploadZone?.addEventListener('dragleave', () => uploadZone.classList.remove('is-dragging'));
    uploadZone?.addEventListener('drop', (event) => {
      event.preventDefault();
      uploadZone.classList.remove('is-dragging');
      void loadFiles(Array.from(event.dataTransfer?.files ?? []));
    });
  };

  const attachInteractions = () => {
    root.querySelectorAll<HTMLElement>('[data-filter]').forEach((button) => {
      button.addEventListener('click', () => {
        activeFilter = button.dataset.filter as FilterType;
        render();
      });
    });
    root.querySelectorAll<HTMLSelectElement>('[data-action="type"]').forEach((select) => {
      select.addEventListener('change', () => {
        questions = updateQuestionType(questions, select.dataset.id ?? '', select.value as QuestionType);
        render();
      });
    });
    root.querySelectorAll<HTMLButtonElement>('[data-action="split"]').forEach((button) => {
      button.addEventListener('click', () => {
        const id = button.dataset.id ?? '';
        const point = root.querySelector<HTMLSelectElement>(`[data-action="split-point"][data-id="${CSS.escape(id)}"]`);
        questions = splitQuestion(questions, id, Number(point?.value));
        render();
      });
    });
    root.querySelectorAll<HTMLButtonElement>('[data-action="merge"]').forEach((button) => {
      button.addEventListener('click', () => {
        questions = mergeWithNext(questions, button.dataset.id ?? '');
        render();
      });
    });
    root.querySelectorAll<HTMLButtonElement>('[data-action="promote-review"]').forEach((button) => {
      button.addEventListener('click', () => {
        const item = result?.reviewItems.find((candidate) => candidate.id === button.dataset.reviewId);
        if (!item || !result) return;
        const nextQuestions = promoteReviewRange(questions, item);
        if (nextQuestions !== questions) {
          questions = nextQuestions;
          result.reviewItems = result.reviewItems.filter((candidate) => candidate.id !== item.id);
        }
        render();
      });
    });
    root.querySelectorAll<HTMLButtonElement>('[data-export]').forEach((button) => {
      button.addEventListener('click', () => void exportWord(button.dataset.export as ExportType));
    });
    root.querySelectorAll<HTMLButtonElement>('[data-print]').forEach((button) => {
      button.addEventListener('click', () => {
        printType = button.dataset.print as ExportType;
        root.dataset.printing = 'true';
        render();
        services.print();
        delete root.dataset.printing;
        render();
      });
    });
  };

  const render = () => {
    root.className = 'app-shell';
    if (!result) {
      root.innerHTML = `<header class="brand-row"><a class="brand" href="#"><span>卷</span>试卷归集台</a><small>WORD EXAM WORKBENCH</small></header><div class="landing-grid">${renderInitial()}</div>`;
      attachFileInput();
      return;
    }
    const visibleQuestions = questions.filter((question) => activeFilter === 'all' || question.type === activeFilter);
    root.innerHTML = `
      <header class="brand-row"><a class="brand" href="#"><span>卷</span>试卷归集台</a><small>WORD EXAM WORKBENCH</small></header>
      ${renderSummary()}
      ${renderErrors()}
      <div class="workspace-grid">
        <section class="question-column">
          ${renderFilters()}
          ${renderReviewItems()}
          <div class="question-list">${
            visibleQuestions.length
              ? visibleQuestions
                  .map((question) => renderQuestionCard(question, questions.findIndex((candidate) => candidate.id === question.id)))
                  .join('')
              : '<div class="empty-state"><strong>当前分类还没有题目</strong><p>可以切换筛选，或把待核对片段加入题目。</p></div>'
          }</div>
        </section>
        ${renderExportPanel()}
      </div>
      ${renderPrintSheet()}
    `;
    attachFileInput();
    attachInteractions();
  };

  const loadFiles = async (files: UploadLike[]) => {
    if (!files.length) return;
    busy = true;
    status = `正在读取 ${files.length} 个文件…`;
    result = undefined;
    render();
    try {
      releaseObjectUrls();
      result = await services.importDocuments(files);
      questions = result.questions;
      activeFilter = 'all';
      status = `已读取 ${result.exams.length} 份试卷，识别 ${questions.length} 道题。`;
    } catch (error) {
      status = error instanceof Error ? error.message : '读取失败';
    } finally {
      busy = false;
      render();
    }
  };

  const exportWord = async (type: ExportType) => {
    if (!result) return;
    exportMessage = `正在生成${TYPE_LABELS[type]}汇总…`;
    render();
    try {
      const exported = await services.exportCategory(type, questions, result.exams);
      const buffer = exported.bytes.buffer.slice(
        exported.bytes.byteOffset,
        exported.bytes.byteOffset + exported.bytes.byteLength,
      ) as ArrayBuffer;
      services.download(
        new Blob([buffer], {
          type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        }),
        `${TYPE_LABELS[type]}汇总.docx`,
      );
      exportMessage = exported.warnings.length
        ? `已生成 ${exported.questionCount} 题。${exported.warnings.join('；')}`
        : `已生成 ${exported.questionCount} 题的 Word 汇总。`;
    } catch (error) {
      exportMessage = error instanceof Error ? error.message : '导出失败';
    }
    render();
  };

  render();
  return {
    destroy() {
      releaseObjectUrls();
      root.replaceChildren();
    },
  };
}
