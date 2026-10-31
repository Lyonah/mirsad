import type { Metadata } from 'next';
import './globals.css';
export const metadata:Metadata={title:'مِرصاد — منصة الدعم الفني',description:'إدارة بلاغات الدعم الفني وتوثيق الإجراءات وتسليم المهام مع تصنيف الأولوية بالذكاء الاصطناعي. IT support tickets, handovers and AI priority triage.',icons:{icon:'/favicon.svg'}};
// يضبط اللغة والاتجاه والوضع الليلي قبل أول رسم للصفحة لتجنّب الوميض.
const preload=`try{var l=localStorage.getItem('mirsad-lang')==='en'?'en':'ar',d=document.documentElement;d.lang=l;d.dir=l==='en'?'ltr':'rtl';var t=localStorage.getItem('mirsad-theme');d.dataset.theme=t||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light')}catch(e){}`;
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="ar" dir="rtl" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{__html:preload}}/></head><body>{children}</body></html>}
