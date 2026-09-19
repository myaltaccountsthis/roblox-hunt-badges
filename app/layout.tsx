import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'The Hunt 20 — Badge Watch', description: 'Live badge award counts for The Hunt: Roblox 20. Twenty hub badges, twenty event games, and updates every minute.', icons: { icon: '/favicon.svg', shortcut: '/favicon.svg' } };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }
