import './globals.css';
import type { Metadata } from 'next';
export const metadata: Metadata={title:'Digital Mosaic Wall',description:'Real-time event photo mosaic activation'};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>}
