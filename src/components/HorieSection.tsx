import Link from 'next/link';
import { Article } from '@/types/news';

interface HorieSectionProps {
  articles: Article[];
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('ja-JP', {
    month: 'numeric',
    day: 'numeric',
  });
}

export default function HorieSection({ articles }: HorieSectionProps) {
  if (articles.length === 0) return null;

  const [featured, ...rest] = articles;

  return (
    <section className="mb-6">
      {/* セクションヘッダー */}
      <div className="flex items-center gap-2 mb-3">
        <span className="flex items-center gap-1.5">
          <span className="text-base">🚀</span>
          <h2 className="text-sm font-bold text-gray-900">ホリエモン視点</h2>
        </span>
        <span className="px-2 py-0.5 bg-orange-100 text-orange-600 text-[10px] font-bold rounded-full">
          メルマガ
        </span>
      </div>

      {/* フィーチャード記事（最新号） */}
      <Link href={`/news/${featured.id}`} className="block group mb-3">
        <article className="relative overflow-hidden rounded-xl border border-orange-100 bg-gradient-to-br from-orange-50 to-amber-50 hover:shadow-md transition-all duration-200">
          <div className="p-4">
            <div className="flex items-start gap-3">
              {/* サムネイル */}
              <div className="flex-shrink-0 w-16 h-16 rounded-lg overflow-hidden bg-gray-200">
                <img
                  src={featured.imageUrl}
                  alt={featured.title}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                />
              </div>

              {/* テキスト */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="px-1.5 py-0.5 bg-orange-500 text-white text-[9px] font-bold rounded">
                    最新号
                  </span>
                  <span className="text-[10px] text-gray-400">{featured.source}</span>
                </div>
                <p className="text-sm font-semibold text-gray-900 leading-snug line-clamp-2 group-hover:text-orange-600 transition-colors">
                  {featured.title}
                </p>
                <p className="text-[11px] text-gray-500 mt-1 line-clamp-2 leading-relaxed">
                  {featured.description}
                </p>
              </div>
            </div>
          </div>
        </article>
      </Link>

      {/* サブ記事リスト */}
      {rest.length > 0 && (
        <div className="flex gap-2.5 overflow-x-auto scrollbar-hide -mx-4 px-4 pb-2">
          {rest.map((article) => (
            <Link
              key={article.id}
              href={`/news/${article.id}`}
              className="flex-shrink-0 w-[200px] group"
            >
              <article className="h-full bg-white border border-gray-100 rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-all duration-200">
                <div className="relative h-[80px] overflow-hidden bg-gray-100">
                  <img
                    src={article.imageUrl}
                    alt={article.title}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />
                  <span className="absolute bottom-1.5 left-2 text-white text-[9px] font-bold">
                    {article.source}
                  </span>
                </div>
                <div className="p-2.5">
                  <p className="text-[11px] font-semibold text-gray-900 leading-snug line-clamp-3 group-hover:text-orange-600 transition-colors">
                    {article.title}
                  </p>
                  <p className="text-[10px] text-gray-400 mt-1">{formatDate(article.publishedAt)}</p>
                </div>
              </article>
            </Link>
          ))}
        </div>
      )}

      {/* 区切り線 */}
      <div className="mt-4 border-b border-gray-100" />
    </section>
  );
}
