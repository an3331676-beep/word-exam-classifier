import { mergeWithNext, promoteReviewRange, splitQuestion, updateQuestionType } from './exams/editor';
import { exportCategoryDocx, type ExportedDocx } from './exams/export-docx';
import { importBatch } from './exams/import-batch';
import { renumberAllTypes } from './exams/renumber';
import type {
  AnswerItem,
  BatchResult,
  ClassifiedQuestion,
  DocumentResource,
  ExportQuestionType,
  ParsedExam,
  QuestionGroup,
  QuestionType,
  UploadLike,
} from './exams/model';
import { renderGroupView } from './ui/group-view';
import { renderTypeSelector, selectableTypes } from './ui/type-selector';

type ExportType = ExportQuestionType;

interface AppServices {
  importDocuments(files: UploadLike[]): Promise<BatchResult>;
  exportCategory(
    type: ExportType,
    questions: ClassifiedQuestion[],
    exams: ParsedExam[],
    groups?: QuestionGroup[],
    answers?: AnswerItem[],
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
  let selectedType: ExportType = 'choice';
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
      <p class="hero-copy">一次添加多份可编辑的 .docx。选择一种目标题型，系统会识别文章与小题边界、连续编号，并把答案解析整理到文末。所有处理都在当前浏览器中完成。</p>
      ${renderTypeSelector(selectedType)}
      <label class="upload-zone ${busy ? 'is-busy' : ''}" for="exam-files">
        <input id="exam-files" type="file" accept=".docx" multiple ${busy ? 'disabled' : ''} />
        <span class="upload-icon" aria-hidden="true">＋</span>
        <span class="upload-copy"><strong>${busy ? '正在分析文档…' : `添加 Word 试卷，提取${TYPE_LABELS[selectedType]}`}</strong><small>选择多个 .docx，或拖到这里</small></span>
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
          <h1>${TYPE_LABELS[selectedType]}提取结果</h1>
          <p>文章和小题已按上传顺序整理，可随时切换目标题型。</p>
        </div>
        <label class="compact-upload" for="exam-files">
          <input id="exam-files" type="file" accept=".docx" multiple ${busy ? 'disabled' : ''} />
          <span>＋ 重新选择试卷</span>
        </label>
      </section>
      <section class="result-type-selector">${renderTypeSelector(selectedType, true)}</section>
      <section class="metric-grid" aria-label="题型统计">
        ${selectableTypes
          .map(
            (item) => `<button class="metric-card metric-${item.value}${selectedType === item.value ? ' is-selected' : ''}" data-select-type="${item.value}" data-count="${item.value}">
              <span>${item.label}</span><strong>${currentCounts[item.value]}</strong>
            </button>`,
          )
          .join('')}
        <div class="metric-card review-total"><span>需核对线索</span><strong>${reviewCount}</strong></div>
      </section>
    `;
  };

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
            ${question.outputNumber ? `<span class="number-chip">第 ${question.outputNumber} 题</span>` : ''}
            <span class="source-chip">${escapeHtml(exam?.source.fileName ?? question.sourceId)}</span>
            <span class="source-chip">原题 ${escapeHtml(question.originalNumber)}</span>
          </div>
          <span class="block-range">段落 ${question.startBlock + 1}—${question.endBlock}</span>
        </header>
        <div class="question-preview">${renderQuestionBody(question)}</div>
        <footer class="question-tools">
          <label>题型
            <select data-action="type" data-id="${escapeHtml(question.id)}">
              ${(['choice', 'fill', 'reading', 'cloze', 'unknown'] as QuestionType[])
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

  const renderGroupMaterial = (group: QuestionGroup): string => {
    const exam = examById(group.sourceId);
    if (!exam) return '<p class="empty-copy">文章来源文档不可用</p>';
    const blocks: string[] = [];
    for (let index = group.materialStartBlock; index < group.materialEndBlock; index += 1) {
      blocks.push(renderBlock(exam, index));
    }
    return blocks.join('');
  };

  const renderSelectedQuestionList = (): string => {
    const selectedQuestions = questions.filter((question) => question.type === selectedType);
    if (selectedType !== 'reading' && selectedType !== 'cloze') {
      return selectedQuestions
        .map((question) => renderQuestionCard(
          question,
          questions.findIndex((candidate) => candidate.id === question.id),
        ))
        .join('');
    }

    const questionById = new Map(selectedQuestions.map((question) => [question.id, question]));
    const rendered = new Set<string>();
    const grouped = (result?.groups ?? [])
      .filter((group) => group.type === selectedType)
      .map((group, groupIndex) => {
        const members = group.questionIds
          .map((id) => questionById.get(id))
          .filter((question): question is ClassifiedQuestion => Boolean(question));
        for (const member of members) rendered.add(member.id);
        if (!members.length) return '';
        return renderGroupView({
          group,
          groupIndex,
          questions: members,
          renderMaterial: () => renderGroupMaterial(group),
          renderQuestion: (question) => renderQuestionCard(
            question,
            questions.findIndex((candidate) => candidate.id === question.id),
          ),
        });
      })
      .join('');
    const ungrouped = selectedQuestions
      .filter((question) => !rendered.has(question.id))
      .map((question) => renderQuestionCard(
        question,
        questions.findIndex((candidate) => candidate.id === question.id),
      ))
      .join('');
    return grouped + ungrouped;
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
      <div><span class="eyebrow">输出汇总</span><h2>导出${TYPE_LABELS[selectedType]}</h2><p>文章只保留一次，小题从 1 连续编号；已匹配的答案解析统一置于文末。</p></div>
      <div class="answer-match-summary"><span>已匹配答案</span><b>${questions.filter((question) => question.type === selectedType && question.answerId).length} / ${counts()[selectedType]}</b></div>
      <div class="export-row"><span><b>${TYPE_LABELS[selectedType]}</b><small>${counts()[selectedType]} 题</small></span><button data-export="${selectedType}" ${counts()[selectedType] ? '' : 'disabled'}>导出 Word</button><button class="ghost-button" data-print="${selectedType}" ${counts()[selectedType] ? '' : 'disabled'}>打印 PDF</button></div>
      ${exportMessage ? `<p class="export-message" role="status">${escapeHtml(exportMessage)}</p>` : ''}
    </aside>
  `;

  const renderPrintSheet = () => {
    const printable = questions.filter((question) => question.type === printType);
    const printableById = new Map(printable.map((question) => [question.id, question]));
    const answerByQuestionId = new Map(
      (result?.answers ?? [])
        .filter((answer) => answer.questionId && printableById.has(answer.questionId))
        .map((answer) => [answer.questionId!, answer]),
    );
    const printQuestion = (question: ClassifiedQuestion, fallback: number) => {
      const exam = examById(question.sourceId);
      return `<article class="print-question"><h2>${question.outputNumber ?? fallback}. <span>${escapeHtml(
        exam?.source.fileName ?? question.sourceId,
      )} · 原题 ${escapeHtml(question.originalNumber)}</span></h2>${renderQuestionBody(question, true)}</article>`;
    };
    const groups = (result?.groups ?? []).filter((group) => group.type === printType);
    const groupedBody = (printType === 'reading' || printType === 'cloze') && groups.length
      ? groups.map((group, groupIndex) => {
          const exam = examById(group.sourceId);
          const material = exam
            ? Array.from(
                { length: group.materialEndBlock - group.materialStartBlock },
                (_, index) => renderBlock(exam, group.materialStartBlock + index, true),
              ).join('')
            : '';
          const members = group.questionIds
            .map((id) => printableById.get(id))
            .filter((question): question is ClassifiedQuestion => Boolean(question));
          return `<section class="print-passage"><h2>${printType === 'reading' ? '阅读' : '完形'} ${groupIndex + 1}</h2>${material}${members.map((question, index) => printQuestion(question, index + 1)).join('')}</section>`;
        }).join('')
      : printable.map((question, index) => printQuestion(question, index + 1)).join('');
    const answerBody = printable
      .filter((question) => answerByQuestionId.has(question.id))
      .map((question, index) => {
        const answer = answerByQuestionId.get(question.id)!;
        const text = answer.originalNumber
          ? answer.text.replace(new RegExp(`^${answer.originalNumber}\\s*[.、)）]\\s*`), '')
          : answer.text;
        return `<p><b>${question.outputNumber ?? index + 1}.</b> ${escapeHtml(text)}</p>`;
      }).join('');
    return `<section class="print-sheet">
      <h1>${TYPE_LABELS[printType]}汇总</h1>
      ${groupedBody}
      ${answerBody ? `<section class="print-answers"><h2>答案与解析</h2>${answerBody}</section>` : ''}
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

  const selectType = (type: ExportType) => {
    selectedType = type;
    printType = type;
    exportMessage = '';
    render();
  };

  const attachTypeSelection = () => {
    root.querySelectorAll<HTMLInputElement>('input[name="target-type"]').forEach((input) => {
      input.addEventListener('click', () => selectType(input.value as ExportType));
    });
    root.querySelectorAll<HTMLButtonElement>('[data-select-type]').forEach((button) => {
      button.addEventListener('click', () => selectType(button.dataset.selectType as ExportType));
    });
  };

  const attachInteractions = () => {
    attachTypeSelection();
    root.querySelectorAll<HTMLSelectElement>('[data-action="type"]').forEach((select) => {
      select.addEventListener('change', () => {
        const nextType = select.value as QuestionType;
        questions = renumberAllTypes(
          updateQuestionType(questions, select.dataset.id ?? '', nextType),
        ).questions;
        if (nextType !== 'unknown' && nextType !== 'solution') selectedType = nextType;
        render();
      });
    });
    root.querySelectorAll<HTMLButtonElement>('[data-action="split"]').forEach((button) => {
      button.addEventListener('click', () => {
        const id = button.dataset.id ?? '';
        const point = root.querySelector<HTMLSelectElement>(`[data-action="split-point"][data-id="${CSS.escape(id)}"]`);
        questions = renumberAllTypes(splitQuestion(questions, id, Number(point?.value))).questions;
        render();
      });
    });
    root.querySelectorAll<HTMLButtonElement>('[data-action="merge"]').forEach((button) => {
      button.addEventListener('click', () => {
        questions = renumberAllTypes(mergeWithNext(questions, button.dataset.id ?? '')).questions;
        render();
      });
    });
    root.querySelectorAll<HTMLButtonElement>('[data-action="promote-review"]').forEach((button) => {
      button.addEventListener('click', () => {
        const item = result?.reviewItems.find((candidate) => candidate.id === button.dataset.reviewId);
        if (!item || !result) return;
        const nextQuestions = promoteReviewRange(questions, item);
        if (nextQuestions !== questions) {
          questions = renumberAllTypes(nextQuestions).questions;
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
      attachTypeSelection();
      return;
    }
    const visibleQuestions = questions.filter((question) => question.type === selectedType);
    root.innerHTML = `
      <header class="brand-row"><a class="brand" href="#"><span>卷</span>试卷归集台</a><small>WORD EXAM WORKBENCH</small></header>
      ${renderSummary()}
      ${renderErrors()}
      <div class="workspace-grid">
        <section class="question-column">
          ${renderReviewItems()}
          <div class="question-list">${
            visibleQuestions.length
              ? renderSelectedQuestionList()
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
      const exported = await services.exportCategory(type, questions, result.exams, result.groups, result.answers);
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
const BRIDGE_CHANNEL = 'english-assistant-exam-bridge';

  const handleBridgeMessage = async (event: MessageEvent) => {
    if (window.parent === window || event.source !== window.parent) return;
    const message = event.data;
    if (!message || message.channel !== BRIDGE_CHANNEL) return;

    if (message.type === 'PING') {
      window.parent.postMessage({ channel: BRIDGE_CHANNEL, type: 'READY' }, event.origin === 'null' ? '*' : event.origin);
      return;
    }
    if (message.type !== 'PROCESS') return;

    const requestId = typeof message.requestId === 'string' ? message.requestId : '';
    const files = Array.isArray(message.files)
      ? message.files.filter((file: unknown): file is UploadLike => {
          if (!file || typeof file !== 'object') return false;
          const candidate = file as Partial<UploadLike>;
          return typeof candidate.name === 'string'
            && candidate.name.toLowerCase().endsWith('.docx')
            && typeof candidate.arrayBuffer === 'function';
        })
      : [];
    const types = Array.isArray(message.questionTypes)
      ? message.questionTypes.filter((type: unknown): type is ExportType =>
          selectableTypes.some((item) => item.value === type),
        )
      : [];

    const targetOrigin = event.origin === 'null' ? '*' : event.origin;
    const respond = (payload: Record<string, unknown>) => {
      window.parent.postMessage(
        { channel: BRIDGE_CHANNEL, requestId, ...payload },
        targetOrigin,
      );
    };

    if (!requestId || files.length === 0 || types.length === 0) {
      respond({ type: 'RESULT', success: false, error: '缺少有效的 Word 文件或题型。' });
      return;
    }

    if (busy) {
      respond({ type: 'RESULT', success: false, error: '试卷处理工具正在处理另一项任务，请稍后重试。' });
      return;
    }

    busy = true;
    status = `聊天助手正在提交 ${files.length} 份 Word 试卷…`;
    exportMessage = '';
    render();

    try {
      releaseObjectUrls();
      result = await services.importDocuments(files);
      questions = result.questions;

      const outputs: Array<{
        type: ExportType;
        fileName: string;
        blob: Blob;
        questionCount: number;
      }> = [];
      const warnings: string[] = result.fileErrors.map((item) => `${item.fileName}: ${item.message}`);
      if (result.reviewItems.length > 0) {
        warnings.push(`另有 ${result.reviewItems.length} 处题目边界或识别线索需要核对。`);
      }

      for (const type of types) {
        const exported = await services.exportCategory(
          type,
          questions,
          result.exams,
          result.groups,
          result.answers,
        );
        const buffer = exported.bytes.buffer.slice(
          exported.bytes.byteOffset,
          exported.bytes.byteOffset + exported.bytes.byteLength,
        ) as ArrayBuffer;
        outputs.push({
          type,
          fileName: `${TYPE_LABELS[type]}汇总.docx`,
          blob: new Blob([buffer], {
            type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          }),
          questionCount: exported.questionCount,
        });
        warnings.push(...exported.warnings);
      }

      status = `聊天助手已处理 ${files.length} 份试卷，导出 ${outputs.length} 份专项卷。`;
      render();
      respond({ type: 'RESULT', success: true, files: outputs, warnings });
    } catch (error) {
      const message = error instanceof Error ? error.message : '试卷处理失败';
      status = message;
      render();
      respond({ type: 'RESULT', success: false, error: message });
    } finally {
      busy = false;
      render();
    }
  };

  window.addEventListener('message', handleBridgeMessage);

  render();
  return {
    destroy() {
      releaseObjectUrls();
      root.replaceChildren();
    },
  };
}
