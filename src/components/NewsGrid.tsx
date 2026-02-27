import { Article } from '@/types/news';
import NewsCard from './NewsCard';

interface NewsGridProps {
  articles: Article[];
}

export default function NewsGrid({ articles }: NewsGridProps) {
  if (articles.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="text-5xl mb-4">📰</div>
        <p className="text-gray-500 text-lg font-medium">記事が見つかりませんでした</p>
        <p className="text-gray-400 text-sm mt-1">別のキーワードで検索してみてください</p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-gray-100">
      {articles.map((article) => (
        <NewsCard key={article.id} article={article} />
      ))}
    </div>
  );
}
