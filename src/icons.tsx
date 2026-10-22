import type { CSSProperties } from 'react';
const paths: Record<string, string> = {
 pulse:'M2 12h5l3-8 4 16 3-8h5', grid:'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
 issue:'M12 3 2 21h20L12 3z M12 9v5 M12 17h.01', stream:'M4 6h16 M4 12h16 M4 18h16 M8 4v4 M16 10v4 M10 16v4',
 flask:'M9 3h6 M10 3v6L4 19a1 1 0 0 0 1 2h14a1 1 0 0 0 1-2L14 9V3 M7 15h10',
 book:'M4 3h12a3 3 0 0 1 3 3v15H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3 M3 17h16 M7 7h8 M7 11h6',
 search:'m21 21-4.8-4.8 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0', chevron:'m9 5 7 7-7 7', down:'m6 9 6 6 6-6',
 arrow:'M5 12h14 m-5-5 5 5-5 5', check:'m5 12 4 4L19 6', close:'m6 6 12 12 M6 18 18 6',
 copy:'M9 9h12v12H9z M5 15H3V3h12v2', download:'M12 3v12 m-5-5 5 5 5-5 M4 16v5h16v-5',
 clock:'M12 8v5l3 2 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0', code:'m8 7-5 5 5 5 m8-10 5 5-5 5 m-3-14-2 18',
 refresh:'M20 7a9 9 0 1 0 1 8 M20 3v5h-5', play:'m8 4 13 8-13 8V4z',
 trash:'M3 6h18 M9 6V3h6v3 M5 6l1 15h12l1-15 M10 10v7 M14 10v7', menu:'M3 6h18 M3 12h18 M3 18h18',
 monitor:'M3 3h18v13H3z M12 16v5 M8 21h8', layers:'m12 3 10 5-10 5L2 8l10-5z M2 12l10 5 10-5 M2 16l10 5 10-5',
 dot:'M12 12h.01', folder:'M3 5h7l2 3h9v12H3V5z', info:'M12 11v6 M12 7h.01 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
 bolt:'m13 2-9 12h7l-1 8L21 9h-8l1-7z', terminal:'m4 6 5 6-5 6 M12 18h8', database:'M3 6c0-5 18-5 18 0s-18 5-18 0 M3 6v12c0 5 18 5 18 0V6 M3 12c0 5 18 5 18 0',
 external:'M14 3h7v7 M21 3 10 14 M11 3H3v18h18v-8', shield:'m12 2 8 4v6c0 5-8 10-8 10S4 17 4 12V6l8-4z m-4 9 3 3 5-6',
 branch:'M6 3v13a3 3 0 1 0 0 6 3 3 0 0 0 0-6 M6 12h7a5 5 0 0 0 5-5V3 M3 3a3 3 0 1 0 6 0 M15 3a3 3 0 1 0 6 0'
};
export function Icon({ name, size=18, style, className='' }: { name: string; size?: number; style?: CSSProperties; className?: string }) {
 return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className} style={style}><path d={paths[name] || paths.code}/></svg>;
}
