import Link from 'next/link';
import { Article } from '@/types/news';

interface JREITSectionProps {
  articles: Article[];
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('ja-JP', {
    month: 'numeric',
    day: 'numeric',
  });
}

export default function JREITSection({ articles }: JREITSectionProps) {
  if (articles.length === 0) return null;

  return (
    <section className="mb-6">
      {/* セクションヘッダー */}
      <div className="flex items-center gap-2 mb-3">
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-blue-700 animate-pulse" />
          <h2 className="text-sm font-bold text-gray-900">J-REIT 物件売買速報</h2>
        </span>
        <span className="text-gray-400 text-xs font-medium">{articles.length}件</span>
      </div>

      {/* 横スクロール */}
      <div className="flex gap-3 overflow-x-auto scrollbar-hide -mx-4 px-4 pb-2">
        {articles.map((article) => (
          <Link
            key={article.id}
            href={`/news/${article.id}`}
            className="flex-shrink-0 w-[220px] group"
          >
            <article className="h-full bg-white border border-gray-100 rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-all duration-200">
              {/* サムネイル */}
              <div className="relative h-[100px] overflow-hidden bg-gray-100">
                <img
                  src={article.imageUrl}
                  alt={article.title}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-blue-900/75 to-transparent" />
                <span className="absolute bottom-2 left-2 px-2 py-0.5 bg-blue-800 text-white text-[10px] font-bold rounded-md tracking-wide">
                  J-REIT
                </span>
              </div>

              {/* テキスト */}
              <div className="p-2.5">
                <p className="text-[11px] font-semibold text-gray-900 leading-snug line-clamp-3 mb-2 group-hover:text-blue-700 transition-colors">
                  {article.title}
                </p>
                <div className="flex items-center justify-between text-[10px] text-gray-400">
                  <span className="truncate mr-1 max-w-[110px]">{article.source}</span>
                  <span className="flex-shrink-0">{formatDate(article.publishedAt)}</span>
                </div>
              </div>
            </article>
          </Link>
        ))}
      </div>

      {/* 区切り線 */}
      <div className="mt-4 border-b border-gray-100" />
    </section>
  );
}
