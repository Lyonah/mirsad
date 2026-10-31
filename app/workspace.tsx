'use client';
import { useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';
import { shell } from './shell';
const VERSION='i18n-20261101';
// يحمّل قاموس الترجمة أولًا ثم واجهة مرصاد.
function load(id:string,src:string,next?:()=>void){const s=document.createElement('script');s.id=id;s.src=src+'?v='+VERSION;if(next)s.onload=next;s.onerror=()=>next?.();document.body.appendChild(s)}
export default function Workspace(){useEffect(()=>{const w=window as unknown as {MirsadCreateClient:typeof createClient;MirsadStarted?:boolean};w.MirsadCreateClient=createClient;if(w.MirsadStarted)return;w.MirsadStarted=true;load('mirsad-i18n','/mirsad-i18n.js',()=>load('mirsad-runtime','/mirsad.js'));},[]);return <div dangerouslySetInnerHTML={{__html:shell}}/>}
