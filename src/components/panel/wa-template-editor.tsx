"use client";

/**
 * Editor de la plantilla de WhatsApp: el texto se escribe normal y las
 * variables se ven como pastillas lima ("Nombre") que se borran enteras con
 * una tecla (contenteditable=false). Los botones de abajo insertan la variable
 * donde está el cursor (o al final). Se guarda como hoy: texto con {variables}
 * en un campo oculto.
 *
 * El editor no lo controla React (contenteditable): se arma con nodos del DOM
 * (createTextNode, nunca HTML con texto del dueño) y se lee en cada cambio.
 */
import { useEffect, useRef, useState } from "react";
import {
  DEFAULT_WA_TEMPLATE, WA_TEMPLATE_MAX, WA_VARS, isWaVar, parseTemplate, previewTemplate, waVarLabel, type WaVar,
} from "@/lib/wa-template";

const PILL = "mx-0.5 inline-flex items-center rounded-full bg-accent px-2 py-0.5 align-baseline text-sm font-extrabold text-on-accent select-all";

function pill(key: WaVar): HTMLSpanElement {
  const s = document.createElement("span");
  s.contentEditable = "false";
  s.dataset.var = key;
  s.className = PILL;
  s.textContent = waVarLabel(key);
  return s;
}

function render(el: HTMLElement, template: string) {
  el.replaceChildren(...parseTemplate(template).map((s) => (s.type === "var" ? pill(s.key) : document.createTextNode(s.text))));
}

/** Lee el editor como texto con {variables}. */
function serialize(el: HTMLElement): string {
  let out = "";
  const walk = (n: Node, top: boolean) => {
    if (n.nodeType === Node.TEXT_NODE) { out += n.textContent ?? ""; return; }
    if (!(n instanceof HTMLElement)) return;
    const key = n.dataset.var;
    if (key && isWaVar(key)) { out += `{${key}}`; return; }
    if (n.tagName === "BR") { out += "\n"; return; }
    // Chrome a veces envuelve renglones en <div>
    if (!top && n.tagName === "DIV" && out !== "" && !out.endsWith("\n")) out += "\n";
    n.childNodes.forEach((c) => walk(c, false));
  };
  el.childNodes.forEach((c) => walk(c, true));
  return out.replace(/ /g, " ");
}

export function WaTemplateEditor({ initial }: { initial: string | null }) {
  const start = initial && initial.trim() !== "" ? initial : DEFAULT_WA_TEMPLATE;
  const [value, setValue] = useState(start);
  const editor = useRef<HTMLDivElement>(null);
  const lastRange = useRef<Range | null>(null);

  useEffect(() => { if (editor.current) render(editor.current, start); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Recordar dónde estaba el cursor dentro del editor (los botones lo usan aunque el foco se vaya)
  useEffect(() => {
    const onSel = () => {
      const sel = document.getSelection();
      if (sel && sel.rangeCount > 0 && editor.current?.contains(sel.anchorNode)) lastRange.current = sel.getRangeAt(0).cloneRange();
    };
    document.addEventListener("selectionchange", onSel);
    return () => document.removeEventListener("selectionchange", onSel);
  }, []);

  const sync = () => { if (editor.current) setValue(serialize(editor.current)); };

  function insertNode(node: Node) {
    const el = editor.current!;
    const range = lastRange.current && el.contains(lastRange.current.startContainer) ? lastRange.current : null;
    if (range) {
      range.deleteContents();
      range.insertNode(node);
    } else {
      el.appendChild(node);
    }
    // Cursor después de lo insertado
    const after = document.createRange();
    after.setStartAfter(node);
    after.collapse(true);
    const sel = document.getSelection();
    el.focus();
    sel?.removeAllRanges();
    sel?.addRange(after);
    lastRange.current = after.cloneRange();
    sync();
  }

  const insertVar = (key: WaVar) => insertNode(pill(key));

  function reset() {
    if (!editor.current) return;
    render(editor.current, DEFAULT_WA_TEMPLATE);
    lastRange.current = null;
    setValue(DEFAULT_WA_TEMPLATE);
  }

  const tooLong = value.length > WA_TEMPLATE_MAX;

  return (
    <div>
      <input type="hidden" name="whatsapp_template" value={value} readOnly />
      <div
        ref={editor}
        role="textbox"
        aria-multiline="true"
        aria-label="Mensaje de WhatsApp"
        aria-describedby="wa-ayuda"
        contentEditable
        suppressContentEditableWarning
        data-testid="wa-editor"
        onInput={sync}
        // Sin pegar HTML: solo texto (las {variables} escritas o pegadas se vuelven pastillas al salir)
        onPaste={(e) => {
          e.preventDefault();
          insertNode(document.createTextNode(e.clipboardData.getData("text/plain")));
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); insertNode(document.createTextNode("\n")); }
        }}
        onBlur={() => {
          // "{nombre}" escrito a mano → pastilla
          if (editor.current && /\{(nombre|cancha|dia|hora|total)\}/.test(editor.current.textContent ?? "")) {
            render(editor.current, serialize(editor.current));
            lastRange.current = null;
          }
        }}
        className="min-h-24 w-full whitespace-pre-wrap break-words rounded-lg border border-line bg-surface px-3 py-2.5 text-base leading-8 text-ink shadow-sm
          focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/25"
      />
      <p id="wa-ayuda" className="mt-1 flex justify-between gap-3 text-xs text-ink-muted">
        <span>Tocá un dato para sumarlo donde está el cursor.</span>
        <span className={tooLong ? "font-extrabold text-danger" : ""} data-testid="wa-contador">{value.length}/{WA_TEMPLATE_MAX}</span>
      </p>

      <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Datos del turno">
        {WA_VARS.map((v) => (
          <button
            key={v.key}
            type="button"
            data-testid="wa-variable"
            // Sin robar la selección del editor antes del clic
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => insertVar(v.key)}
            className="inline-flex min-h-11 items-center rounded-full border border-line bg-surface px-4 text-sm font-extrabold text-ink hover:border-primary"
          >
            + {v.label}
          </button>
        ))}
        <button
          type="button"
          onClick={reset}
          data-testid="wa-original"
          className="inline-flex min-h-11 items-center rounded-full px-3 text-sm font-extrabold text-ink underline underline-offset-4 hover:opacity-80"
        >
          Volver al mensaje original
        </button>
      </div>

      {value.trim() && (
        <div className="mt-3 rounded-lg border border-transparent bg-accent px-3 py-2" data-testid="wa-vista-previa">
          <p className="mb-1 text-xs font-medium text-on-accent">Vista previa:</p>
          <p className="whitespace-pre-wrap text-sm text-on-accent">{previewTemplate(value)}</p>
        </div>
      )}
    </div>
  );
}
