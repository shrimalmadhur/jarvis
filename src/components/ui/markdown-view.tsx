"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const plugins = [remarkGfm];

interface MarkdownViewProps {
  content: string;
  className?: string;
}

export function MarkdownView({ content, className = "" }: MarkdownViewProps) {
  return (
    <div className={`prose-markdown ${className}`}>
      <ReactMarkdown remarkPlugins={plugins}>{content}</ReactMarkdown>
    </div>
  );
}
