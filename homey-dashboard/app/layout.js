import { Inter } from 'next/font/google';
import './globals.css';

// Self-hosted at build time by next/font — no request to Google from the browser.
const inter = Inter({ subsets: ['latin'], display: 'swap', variable: '--font-inter' });

export const metadata = {
  title: 'Skovgaard Dashboard',
  description: 'Live room status and flow overview for your Homey.',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover', // lets the bottom bar reach past the iPhone's home indicator
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#eef2f8' },
    { media: '(prefers-color-scheme: dark)', color: '#070b16' },
  ],
};

// Apply a theme picked with the header toggle before first paint (no light flash in
// dark mode). Without a pick, the CSS follows the system setting.
const THEME_INIT = `try{var t=localStorage.getItem('hd-theme');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t)}catch(e){}`;

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
