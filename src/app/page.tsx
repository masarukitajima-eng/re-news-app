'use client';

import { useState, useMemo } from 'react';
import { Category } from '@/types/news';
import { mockArticles } from '@/data/mockNews';
import Header from '@/components/Header';
import CategoryFilter from '@/components/CategoryFilter';
import HeroCard from '@/components/HeroCard';
import NewsGrid from '@/components/NewsGrid';

export default function Home() {
  const [selectedCategory, setSelectedCategory] = useState<Category>('トップ');
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  const filteredArticles = useMemo(() => {
    let articles = [...mockArticles].sort(
      (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
    );

    if (selectedCategory !== 'トップ') {
      articles = articles.filter((a) => a.category === selectedCategory);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      articles = articles.filter(
        (a) =>
          a.title.toLowerCase().includes(q) ||
          a.description.toLowerCase().includes(q) ||
          a.source.toLowerCase().includes(q)
      );
    }

    return articles;
  }, [selectedCategory, searchQuery]);

  const handleSearchToggle = () => {
    setIsSearchOpen((prev) => {
      if (prev) setSearchQuery('');
      return !prev;
    });
  };

  const heroArticle = filteredArticles[0];
  const gridArticles = filteredArticles.slice(1);

  return (
    <div className="min-h-screen bg-white">
      <Header
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        isSearchOpen={isSearchOpen}
        onSearchToggle={handleSearchToggle}
      />
      <CategoryFilter selected={selectedCategory} onSelect={setSelectedCategory} />
      <main className="max-w-4xl mx-auto px-4 py-5">
        {filteredArticles.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="text-6xl mb-4">🔍</div>
            <p className="text-gray-500 text-xl font-medium">記事が見つかりませんでした</p>
            <p className="text-gray-400 text-sm mt-2">別のキーワードで検索してみてください</p>
          </div>
        ) : (
          <>
            {heroArticle && (
              <div className="mb-5">
                <HeroCard article={heroArticle} />
              </div>
            )}
            {gridArticles.length > 0 && (
              <section>
                <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">
                  {searchQuery ? '検索結果' : selectedCategory === 'トップ' ? '最新ニュース' : selectedCategory}
                </h2>
                <NewsGrid articles={gridArticles} />
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}
