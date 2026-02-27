import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "NewsApp - 最新ニュース",
  description: "Apple Newsスタイルの日本語ニュースアプリ",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body className="bg-white text-gray-900 antialiased">
        {children}
      </body>
    </html>
  );
}
