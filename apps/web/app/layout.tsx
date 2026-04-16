import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import './globals.css';

export const metadata: Metadata = {
  title: 'Arbibot 2 — Operator',
  description: 'Unified operator surface (Phase 1 scaffold)',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>): ReactNode {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
(function(){
  try {
    var t = localStorage.getItem('arbibot-theme');
    var mode = t === 'light' ? 'light' : 'dark';
    document.documentElement.dataset.theme = mode;
    if (mode === 'light') document.documentElement.classList.add('theme-light');
  } catch (e) {
    document.documentElement.dataset.theme = 'dark';
  }
})();`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
