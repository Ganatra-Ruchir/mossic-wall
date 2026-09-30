import type { Config } from 'tailwindcss';
export default { content: ['./app/**/*.{ts,tsx}','./components/**/*.{ts,tsx}'], theme: { extend: { colors: { ink:'#08090b', panel:'#111318', line:'#242832', accent:'#d8ff3e' } } }, plugins: [] } satisfies Config;
