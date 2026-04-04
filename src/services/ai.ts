import type { ChapterRecommendation } from '../types';
import type { PersonalityProfile } from './personality';

export interface Highlight {
  text: string;
  type: 'insight' | 'action' | 'concept';
  color: string;
}

export interface MindMapNode {
  name: string;
  children?: MindMapNode[];
}

const HIGHLIGHT_COLORS: Record<Highlight['type'], string> = {
  insight: '#fbbf24',
  action: '#60a5fa',
  concept: '#a78bfa',
};

function getApiKey(): string {
  return localStorage.getItem('claude-api-key') || '';
}

export function hasApiKey(): boolean {
  return !!getApiKey();
}

export function setApiKey(key: string) {
  localStorage.setItem('claude-api-key', key);
}

export function getReadingProfile(): { interests: string; goal: string } {
  return {
    interests: localStorage.getItem('reading-interests') || '',
    goal: localStorage.getItem('reading-goal') || '',
  };
}

export function setReadingProfile(interests: string, goal: string) {
  localStorage.setItem('reading-interests', interests);
  localStorage.setItem('reading-goal', goal);
}

type MsgContent = string | Array<{ type: 'text'; text: string } | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }>;

async function callClaude(messages: { role: string; content: MsgContent }[], useWebSearch = false): Promise<string> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('请先设置 Claude API Key');

  const body: Record<string, unknown> = {
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    messages,
  };

  if (useWebSearch) {
    body.tools = [{ type: 'web_search_20250305', name: 'web_search' }];
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `API 请求失败: ${response.status}`);
  }

  const data = await response.json();
  // Collect all text blocks (web_search may return tool_use + text mixed)
  const textBlocks = (data.content as Array<{ type: string; text?: string }>)
    .filter(b => b.type === 'text')
    .map(b => b.text || '')
    .join('');
  return textBlocks;
}

export async function autoClassifyBook(
  title: string,
  contentPreview: string,
  categories: string[]
): Promise<string> {
  const prompt = `根据以下书籍信息，判断它最适合归入哪个分类。

书名：${title}
内容预览：${contentPreview.slice(0, 1000)}

可选分类：${categories.join('、')}

只返回一个分类名，不要任何其他文字。`;

  try {
    const result = await callClaude([{ role: 'user', content: prompt }]);
    const cat = result.trim();
    return categories.includes(cat) ? cat : categories[categories.length - 1];
  } catch {
    return categories[categories.length - 1];
  }
}

export async function generateSummary(text: string, context?: string): Promise<{ summary: string; keyPoints: string[] }> {
  const prompt = `请对以下文本进行总结，提取关键要点。

${context ? `背景信息：${context}\n` : ''}
文本内容：
${text.slice(0, 8000)}

请用以下JSON格式回复（不要包含markdown代码块标记）：
{"summary": "总结内容", "keyPoints": ["要点1", "要点2", "要点3"]}`;

  const result = await callClaude([{ role: 'user', content: prompt }]);
  try {
    return JSON.parse(result);
  } catch {
    return { summary: result, keyPoints: [] };
  }
}

export interface ImageAttachment {
  data: string; // base64 without data-url prefix
  mediaType: string; // e.g. 'image/jpeg'
}

export async function chatAboutBook(
  bookContent: string,
  question: string,
  chatHistory: { role: string; content: string }[],
  image?: ImageAttachment
): Promise<string> {
  const systemContext = `你是一个读书助手。以下是当前阅读的书籍内容片段：

${bookContent.slice(0, 6000)}

请基于这些内容回答用户的问题。书中找不到的信息（如出版年、作者背景、相关评论等）可以通过网络搜索获取。`;

  const lastContent: MsgContent = image
    ? [
        { type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.data } },
        { type: 'text', text: question },
      ]
    : question;

  const messages = [
    { role: 'user', content: systemContext },
    { role: 'assistant', content: '好的，我已经阅读了这段内容。请问您有什么问题？' },
    ...chatHistory.slice(-10),
    { role: 'user', content: lastContent },
  ];

  return callClaude(messages, true);
}

export async function chatAboutBookWithSource(
  bookContent: string,
  question: string,
  chatHistory: { role: string; content: string }[],
  image?: ImageAttachment
): Promise<{ answer: string; sourceQuote: string | null }> {
  const systemContext = `你是一个读书助手。以下是当前阅读的书籍内容片段：

${bookContent.slice(0, 6000)}

请基于这些内容回答用户的问题。书中找不到的信息（如出版年、作者背景、相关评论等）可以通过网络搜索获取。回答时必须严格遵守以下格式：

ANSWER:
[用中文回答问题]

SOURCE:
"[从书中找到最能支撑你答案的一句原文，英文原文，不超过60个词，如找不到相关原文则写null]"`;

  const lastContent: MsgContent = image
    ? [
        { type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.data } },
        { type: 'text', text: question },
      ]
    : question;

  const messages = [
    { role: 'user', content: systemContext },
    { role: 'assistant', content: '好的，我已经阅读了这段内容，将按照格式回答。请问您有什么问题？' },
    ...chatHistory.slice(-10),
    { role: 'user', content: lastContent },
  ];

  const raw = await callClaude(messages, true);

  // Parse ANSWER: and SOURCE: blocks
  const answerMatch = raw.match(/ANSWER:\s*([\s\S]*?)(?=SOURCE:|$)/i);
  const sourceMatch = raw.match(/SOURCE:\s*"([^"]+)"/i);

  const answer = answerMatch ? answerMatch[1].trim() : raw;
  const sourceQuote = sourceMatch ? sourceMatch[1].trim() : null;

  return { answer, sourceQuote };
}

export async function smartAnnotate(selectedText: string, context: string): Promise<string> {
  const prompt = `作为读书助手，请对以下选中的文本进行智能标注和解读。

上下文：
${context.slice(0, 3000)}

选中文本：
"${selectedText}"

请提供：
1. 这段文字的核心含义
2. 为什么这段值得关注
3. 与其他概念的联系（如果有的话）

请简洁明了地回答，控制在200字以内。`;

  return callClaude([{ role: 'user', content: prompt }]);
}

export async function recommendChapters(
  bookContent: string,
  interests: string,
  goal: string
): Promise<ChapterRecommendation[]> {
  const prompt = `作为读书顾问，请根据读者的兴趣和目标，推荐这本书中最值得阅读的章节/部分。

读者兴趣：${interests || '广泛阅读'}
阅读目标：${goal || '获取知识，拓展视野'}

书籍内容概览：
${bookContent.slice(0, 8000)}

请用以下JSON格式回复（不要包含markdown代码块标记），推荐3-5个章节/部分：
[{"chapter": "章节名或描述", "reason": "推荐理由", "priority": "high/medium/low"}]`;

  const result = await callClaude([{ role: 'user', content: prompt }]);
  try {
    return JSON.parse(result);
  } catch {
    return [];
  }
}

export async function autoHighlightKeyPoints(text: string, profile?: PersonalityProfile): Promise<Highlight[]> {
  const profileContext = profile
    ? `\nHighlight content most relevant to someone with interests in ${profile.interests.join(', ')} who prefers ${profile.preferredDepth} depth reading.`
    : '';

  const prompt = `请从以下文本中找出最重要的3-5个关键句子或段落，这些是读者最应该标注和记住的内容。${profileContext}

对每个高亮内容，判断其类型：
- insight: 洞察性观点或启示
- action: 可执行的行动建议
- concept: 重要的概念或定义

文本：
${text.slice(0, 6000)}

请用以下JSON格式回复（不要包含markdown代码块标记），只返回原文中的句子：
[{"text": "句子1", "type": "insight"}, {"text": "句子2", "type": "action"}, {"text": "句子3", "type": "concept"}]`;

  const result = await callClaude([{ role: 'user', content: prompt }]);
  try {
    const parsed = JSON.parse(result) as Array<{ text: string; type: string }>;
    return parsed.map(item => {
      const type = (['insight', 'action', 'concept'].includes(item.type) ? item.type : 'insight') as Highlight['type'];
      return {
        text: item.text,
        type,
        color: HIGHLIGHT_COLORS[type],
      };
    });
  } catch {
    return [];
  }
}

export async function generateMindMap(bookTitle: string, bookContent: string): Promise<MindMapNode> {
  const prompt = `请为以下书籍生成一个思维导图结构，展示书中的核心概念和它们之间的关系。

书名：${bookTitle}

书籍内容节选：
${bookContent.slice(0, 8000)}

请以JSON格式返回思维导图数据（不要包含markdown代码块标记）。格式如下：
{
  "name": "书名（简短）",
  "children": [
    {
      "name": "核心主题1",
      "children": [
        {"name": "子概念1.1"},
        {"name": "子概念1.2", "children": [{"name": "细节1.2.1"}]}
      ]
    },
    {
      "name": "核心主题2",
      "children": [
        {"name": "子概念2.1"},
        {"name": "子概念2.2"}
      ]
    }
  ]
}

要求：
- 根节点是书名缩写（最多10个字）
- 2到5个核心主题（第一层）
- 每个主题下2到4个子概念
- 子概念可以再有1到2个细化节点
- 名称简洁，最多15个字
- 只返回JSON，不要任何其他文字`;

  const result = await callClaude([{ role: 'user', content: prompt }]);
  try {
    // Strip potential markdown fences
    const clean = result.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    return JSON.parse(clean) as MindMapNode;
  } catch {
    // Fallback minimal map
    return {
      name: bookTitle.slice(0, 10),
      children: [
        { name: '生成失败', children: [{ name: '请检查 API Key' }] },
      ],
    };
  }
}
