import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'Folio — Read and listen', description: 'Open PDFs, documents, or images, recognize their text, and listen at your own pace.', icons: { icon: { url: '/favicon.svg?v=book', type: 'image/svg+xml' } } };
export default function RootLayout({children}: Readonly<{children: React.ReactNode}>) { return <html lang="en"><body>{children}</body></html>; }
