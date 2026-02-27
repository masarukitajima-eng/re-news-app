import Link from 'next/link';
import { Article } from '@/types/news';

interface NewsCardProps {
  article: Article;
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('ja-JP', { month: 'long', day: 'numeric' });
}

export default function NewsCard({ article }: NewsCardProps) {
  return (
    <Link href={`/news/${article.id}`} className="block group">
      <article className="flex gap-3 py-4 border-b border-gray-100 last:border-0">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-[#FA2D48] text-xs font-semibold">{article.category}</span>
            <span className="text-gray-300">·</span>
            <span className="text-gray-400 text-xs">{article.source}</span>
          </div>
          <h3 className="text-gray-900 text-sm font-semibold leading-snug line-clamp-3 group-hover:text-[#FA2D48] transition-colors mb-1.5">
            {article.title}
          </h3>
          <div className="flex items-center gap-2 text-gray-400 text-xs">
            <span>{formatDate(article.publishedAt)}</span>
            <span>·</span>
            <span>{article.readTime}分</span>
          </div>
        </div>
        <div className="flex-shrink-0 w-20 h-20 md:w-24 md:h-24 rounded-xl overflow-hidden bg-gray-100">
          <img
            src={article.imageUrl}
            alt={article.title}
            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-110"
          />
        </div>
      </article>
    </Link>
  );
}
