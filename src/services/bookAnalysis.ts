/**
 * bookAnalysis.ts
 * Automated pipeline: upload → extract → summarize → highlight → save annotations
 * Runs in the background after any book is added.
 */
import type { Book, Annotation } from '../types';
import { extractPdfText, saveBookIndex, type BookIndex } from './bookIndex';
import { arrayBufferToText } from './fileParser';
import * as db from './db';
import { generateId } from './fileParser';

export type AnalysisStatus = 'idle' | 'extracting' | 'analyzing' | 'done' | 'error';

export interface AnalysisProgress {
  status: AnalysisStatus;
  message: string;
  pagesExtracted?: number;
  totalPages?: number;
}

type ProgressCallback = (p: AnalysisProgress) => void;

function getApiKey(): string {
  return localStorage.getItem('claude-api-key') || '';
}

async function callClaude(messages: { role: string; content: string }[]): Promise<string> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('请先在设置中配置 Claude API Key');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      messages,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: { message?: string } }).error?.message || `API error ${res.status}`);
  }

  const data = await res.json() as { content: Array<{ text: string }> };
  return data.content[0]?.text || '';
}

/** Extract full text from any book format */
async function extractBookText(book: Book, onProgress: ProgressCallback): Promise<{ pages: Array<{page: number; text: string}>; fullText: string }> {
  if (book.format === 'txt' || book.format === 'md') {
    const text = arrayBufferToText(book.fileData);
    // Split into fake pages of ~2000 chars each
    const chunkSize = 2000;
    const pages = [];
    for (let i = 0; i < text.length; i += chunkSize) {
      pages.push({ page: Math.floor(i / chunkSize) + 1, text: text.slice(i, i + chunkSize) });
    }
    return { pages, fullText: text };
  }

  if (book.format === 'pdf') {
    const pages = await extractPdfText(book.fileData.slice(0) as ArrayBuffer, (cur, total) => {
      onProgress({ status: 'extracting', message: `提取文字中…`, pagesExtracted: cur, totalPages: total });
    });
    const fullText = pages.map(p => p.text).join('\n');
    return { pages, fullText };
  }

  // EPUB: best effort
  const text = new TextDecoder().decode(book.fileData);
  return { pages: [{ page: 1, text: text.slice(0, 50000) }], fullText: text.slice(0, 50000) };
}

/** Main analysis pipeline */
export async function analyzeBook(book: Book, onProgress: ProgressCallback): Promise<void> {
  const apiKey = getApiKey();
  if (!apiKey) {
    onProgress({ status: 'error', message: '请先在设置中配置 Claude API Key' });
    return;
  }

  try {
    // Step 1: Extract text
    onProgress({ status: 'extracting', message: '正在提取全书文字…' });
    const { pages, fullText } = await extractBookText(book, onProgress);

    // Step 2a: Delete existing AI annotations for this book
    const existingAnns = await db.getAnnotations(book.id);
    for (const ann of existingAnns.filter(a => a.isAI)) {
      await db.deleteAnnotation(ann.id);
    }

    // Step 2b: Save index for Q&A
    const index: BookIndex = {
      bookId: book.id,
      title: book.title,
      totalPages: pages.length,
      pages,
      createdAt: Date.now(),
    };
    await saveBookIndex(index);

    // Step 3: Ask Claude to analyze
    onProgress({ status: 'analyzing', message: 'AI 正在分析全书内容…' });

    // Sample from beginning, middle and end to cover the whole book
    const len = fullText.length;
    const chunkSize = 18000;
    const beginning = fullText.slice(0, chunkSize);
    const middle = fullText.slice(Math.floor(len / 2) - chunkSize / 2, Math.floor(len / 2) + chunkSize / 2);
    const ending = fullText.slice(Math.max(0, len - chunkSize));
    const sampleText = `[开头]\n${beginning}\n\n[中段]\n${middle}\n\n[结尾]\n${ending}`;
    const totalPages = pages.length;

    const prompt = `你是一位专业的阅读助手。请分析以下书籍内容，为读者（Mia，20多岁的中国女性，对心理学、自我成长、情感理解感兴趣）生成阅读指导。

书名：《${book.title}》
全书共 ${totalPages} 页，以下是开头、中段、结尾的节选：
${sampleText}

请返回JSON格式（不含markdown代码块），包含：
{
  "summary": "全书核心主旨（150字以内，中文）",
  "keyInsight": "最重要的一个洞见（50字以内，中文）",
  "highlights": [
    {
      "page": <书的页码，整数，必须在1到${totalPages}之间>,
      "text": "<书中的原文引用，英文保持原文，20-80字>",
      "note": "<对Mia的重要性说明，中文，60字以内>",
      "type": "insight|action|concept",
      "priority": "high|medium"
    }
  ]
}

highlights 要求：
- 返回10-15条
- 页码必须分布在全书各处（1-${totalPages}页），不要集中在开头
- 涵盖全书核心概念、最实用的行动建议、最重要的洞见
- 类型：insight=洞察，action=可行动建议，concept=核心概念`;

    const response = await callClaude([{ role: 'user', content: prompt }]);

    let parsed: {
      summary: string;
      keyInsight: string;
      highlights: Array<{
        page: number;
        text: string;
        note: string;
        type: string;
        priority: string;
      }>;
    };

    try {
      // Try to extract JSON
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : response);
    } catch {
      onProgress({ status: 'error', message: 'AI 返回格式解析失败，请重试' });
      return;
    }

    // Step 4: Save as annotations
    onProgress({ status: 'analyzing', message: '正在保存标注…' });

    const typeColors: Record<string, string> = {
      insight: '#fbbf24',
      action: '#60a5fa',
      concept: '#a78bfa',
    };

    const now = Date.now();
    const annotations: Annotation[] = parsed.highlights.map((h, i) => ({
      id: generateId(),
      bookId: book.id,
      text: h.text,
      note: `${h.priority === 'high' ? '🌟' : '💡'} ${h.note}`,
      isAI: true,
      page: h.page || undefined,
      color: typeColors[h.type] || '#fbbf24',
      createdAt: now + i,
    }));

    // Also save a summary annotation on page 1
    annotations.unshift({
      id: generateId(),
      bookId: book.id,
      text: `【全书核心】${parsed.keyInsight}`,
      note: `📖 全书总结：${parsed.summary}`,
      isAI: true,
      page: 1,
      color: '#6366f1',
      createdAt: now - 1,
    });

    for (const ann of annotations) {
      await db.saveAnnotation(ann);
    }

    onProgress({ status: 'done', message: `✅ 分析完成！已生成 ${annotations.length} 条智能标注` });

  } catch (err) {
    onProgress({
      status: 'error',
      message: err instanceof Error ? err.message : '分析失败，请重试',
    });
  }
}
