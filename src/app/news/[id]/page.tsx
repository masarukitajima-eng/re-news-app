import { notFound } from 'next/navigation';
import Link from 'next/link';
import { mockArticles } from '@/data/mockNews';

interface Props {
  params: Promise<{ id: string }>;
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('ja-JP', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

// 【セクション名】: 本文 の形式でパースする
function parseAnalysis(content: string): { label: string; body: string }[] {
  const sectionPattern = /【([^】]+)】[：:]\s*/g;
  const sections: { label: string; body: string }[] = [];
  let match;
  const matches: { index: number; label: string }[] = [];

  while ((match = sectionPattern.exec(content)) !== null) {
    matches.push({ index: match.index, label: match[1] });
  }

  matches.forEach((m, i) => {
    const start = content.indexOf('】', m.index) + 2; // skip 】 and separator
    const colonOffset = content[start] === '：' || content[start] === ':' ? 2 : 0;
    const bodyStart = start + colonOffset;
    const bodyEnd = i + 1 < matches.length ? matches[i + 1].index : content.length;
    const body = content.slice(bodyStart, bodyEnd).trim();
    if (body) sections.push({ label: m.label, body });
  });

  // セクションが見つからなければそのまま返す
  if (sections.length === 0) {
    return [{ label: '', body: content.trim() }];
  }
  return sections;
}

export default async function ArticlePage({ params }: Props) {
  const { id } = await params;
  const article = mockArticles.find((a) => a.id === id);

  if (!article) {
    notFound();
  }

  const sections = parseAnalysis(article.content);

  return (
    <div className="min-h-screen bg-white">
      {/* Sticky back nav */}
      <nav className="sticky top-0 z-50 bg-white/95 backdrop-blur-md border-b border-gray-100">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link
            href="/"
            className="flex items-center gap-1.5 text-[#FA2D48] font-medium text-sm hover:opacity-80 transition-opacity"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
            </svg>
            ニュース一覧
          </Link>
          <span className="text-xs text-gray-400 font-medium">{article.source}</span>
        </div>
      </nav>

      {/* Hero image */}
      <div className="w-full aspect-[16/9] md:aspect-[16/7] overflow-hidden bg-gray-100">
        <img
          src={article.imageUrl}
          alt={article.title}
          className="w-full h-full object-cover"
        />
      </div>

      {/* Article content */}
      <article className="max-w-2xl mx-auto px-4 py-6">
        {/* Category badge */}
        <div className="mb-3">
          <span className="inline-block px-3 py-1 bg-[#FA2D48] text-white text-xs font-semibold rounded-full">
            {article.category}
          </span>
        </div>

        {/* Title */}
        <h1 className="text-2xl md:text-3xl font-bold text-gray-900 leading-tight mb-4">
          {article.title}
        </h1>

        {/* Meta */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-500 pb-5 border-b border-gray-100 mb-6">
          <span className="font-medium text-gray-700">{article.source}</span>
          <span className="text-gray-300">·</span>
          <span>{formatDate(article.publishedAt)}</span>
          <span className="text-gray-300">·</span>
          <span>{article.readTime}分で読める</span>
        </div>

        {/* Structured analysis sections */}
        <div className="space-y-6">
          {sections.map((section, i) => (
            <div key={i}>
              {section.label ? (
                <>
                  <h2 className="text-xs font-bold text-[#FA2D48] uppercase tracking-wider mb-2">
                    {section.label}
                  </h2>
                  <p className="text-gray-800 text-base leading-relaxed">{section.body}</p>
                </>
              ) : (
                <p className="text-gray-800 text-base leading-relaxed">{section.body}</p>
              )}
            </div>
          ))}
        </div>

        {/* Original article link */}
        {article.url && (
          <div className="mt-8 pt-6 border-t border-gray-100">
            <a
              href={article.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-gray-900 text-white rounded-full text-sm font-medium hover:bg-gray-700 transition-colors"
            >
              元記事を読む
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
          </div>
        )}
      </article>

      {/* Bottom nav */}
      <div className="max-w-2xl mx-auto px-4 pb-10">
        <Link
          href="/"
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-gray-100 rounded-full text-sm font-medium text-gray-700 hover:bg-gray-200 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          ニュース一覧に戻る
        </Link>
      </div>
    </div>
  );
}

export function generateStaticParams() {
  return mockArticles.map((article) => ({ id: article.id }));
}
