import Link from 'next/link';
import { Article } from '@/types/news';

interface HeroCardProps {
  article: Article;
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('ja-JP', { month: 'long', day: 'numeric' });
}

export default function HeroCard({ article }: HeroCardProps) {
  return (
    <Link href={`/news/${article.id}`} className="block group">
      <article className="relative overflow-hidden rounded-2xl bg-gray-100 aspect-[16/9] md:aspect-[16/7]">
        <img
          src={article.imageUrl}
          alt={article.title}
          className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent" />
        <div className="absolute bottom-0 left-0 right-0 p-5 md:p-7">
          <span className="inline-block px-2.5 py-1 bg-[#FA2D48] text-white text-xs font-semibold rounded-full mb-3">
            {article.category}
          </span>
          <h2 className="text-white text-xl md:text-2xl font-bold leading-tight mb-2 line-clamp-3">
            {article.title}
          </h2>
          <p className="text-white/80 text-sm line-clamp-2 mb-3 hidden md:block">
            {article.description}
          </p>
          <div className="flex items-center gap-3 text-white/70 text-xs">
            <span>{article.source}</span>
            <span>·</span>
            <span>{formatDate(article.publishedAt)}</span>
            <span>·</span>
            <span>{article.readTime}分で読める</span>
          </div>
        </div>
      </article>
    </Link>
  );
}
