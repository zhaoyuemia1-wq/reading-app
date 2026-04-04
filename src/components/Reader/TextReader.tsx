import { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { arrayBufferToText } from '../../services/fileParser';

interface Props {
  fileData: ArrayBuffer;
  format: 'txt' | 'md';
  onTextSelect: (text: string, context: string) => void;
  onContentReady: (text: string) => void;
}

export default function TextReader({ fileData, format, onTextSelect, onContentReady }: Props) {
  const text = useMemo(() => {
    const content = arrayBufferToText(fileData);
    onContentReady(content);
    return content;
  }, [fileData]);

  const handleMouseUp = () => {
    const selection = window.getSelection();
    const selectedText = selection?.toString().trim();
    if (selectedText && selectedText.length > 0) {
      onTextSelect(selectedText, `${format.toUpperCase()} 文档`);
    }
  };

  return (
    <div className="h-full overflow-auto p-8" onMouseUp={handleMouseUp}>
      <div className="max-w-3xl mx-auto">
        {format === 'md' ? (
          <div className="markdown-content text-slate-200">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
          </div>
        ) : (
          <pre className="text-slate-200 whitespace-pre-wrap font-sans text-lg leading-relaxed">
            {text}
          </pre>
        )}
      </div>
    </div>
  );
}
