import type { Metadata, Viewport } from 'next';
import './globals.css';
import { ToastProvider } from '@/components/ui';
import Splash from '@/components/shell/Splash';

export const metadata: Metadata = { title: 'RPG Birmingham', description: 'Side quests for the Magic City' };
export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Splash />
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
