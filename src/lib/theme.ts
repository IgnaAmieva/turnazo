/**
 * Modo claro / oscuro.
 *
 * - "system" (por defecto) sigue al celular y cambia solo si el celular cambia.
 * - "light" / "dark" quedan guardados en localStorage (solo esta preferencia).
 *
 * THEME_SCRIPT va inline en el <head>: pone data-theme en <html> antes de que
 * se pinte la página (sin parpadeo) y actualiza el color de la barra del
 * celular. Expone window.__setThemeMode para el botón de cambio.
 */

export type ThemeMode = 'system' | 'light' | 'dark';

export const THEME_STORAGE_KEY = 'turnazo-theme';

/** Color de la barra del navegador en el celular = fondo del encabezado. */
export const THEME_BAR_COLORS = { light: '#FFFFFF', dark: '#14523F' } as const;

export const THEME_SCRIPT = `(function(){
var K=${JSON.stringify(THEME_STORAGE_KEY)},C=${JSON.stringify(THEME_BAR_COLORS)};
var root=document.documentElement,mq=window.matchMedia('(prefers-color-scheme: dark)');
function mode(){try{var m=localStorage.getItem(K);if(m==='light'||m==='dark')return m;}catch(e){}return 'system';}
function apply(m){
var t=m==='system'?(mq.matches?'dark':'light'):m;
root.setAttribute('data-theme',t);root.setAttribute('data-theme-mode',m);
var ms=document.querySelectorAll('meta[name="theme-color"]');
for(var i=0;i<ms.length;i++)ms[i].setAttribute('content',C[t]);
}
window.__setThemeMode=function(m){
try{if(m==='system')localStorage.removeItem(K);else localStorage.setItem(K,m);}catch(e){}
apply(m);
};
mq.addEventListener('change',function(){apply(mode());});
document.addEventListener('DOMContentLoaded',function(){apply(mode());});
apply(mode());
})();`;

declare global {
  interface Window { __setThemeMode?: (mode: ThemeMode) => void }
}
