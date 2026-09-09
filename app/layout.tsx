import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'Folio — Read and listen', description: 'Open PDFs, documents, or images, recognize their text, and listen at your own pace.' };
export default function RootLayout({children}: Readonly<{children: React.ReactNode}>) { return <html lang="en"><body>{children}</body></html>; }
