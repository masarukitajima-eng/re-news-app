export type Category = 'トップ' | 'JREIT' | 'HORIE' | 'CBRE' | 'AI・テック' | 'PropTech' | '商業不動産' | '市場動向';

export interface Article {
  id: string;
  title: string;
  description: string;
  content: string;
  category: Category;
  author: string;
  publishedAt: string;
  imageUrl: string;
  source: string;
  url: string;
  readTime: number;
}
