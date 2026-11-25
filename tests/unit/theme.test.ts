/**
 * Script del modo claro/oscuro (src/lib/theme.ts): se ejecuta el mismo texto
 * que va inline en el <head>, con un navegador simulado.
 */
import { describe, expect, it } from "vitest";
import { THEME_BAR_COLORS, THEME_SCRIPT, THEME_STORAGE_KEY, type ThemeMode } from "@/lib/theme";

function fakeBrowser(opts: { prefersDark: boolean; stored?: string | null; storageThrows?: boolean }) {
  const attrs: Record<string, string> = {};
  const metas = [{ content: "", setAttribute(_: string, v: string) { this.content = v; } }];
  const store = new Map<string, string>();
  if (opts.stored) store.set(THEME_STORAGE_KEY, opts.stored);
  const mqListeners: (() => void)[] = [];
  const mq = {
    matches: opts.prefersDark,
    addEventListener: (_: string, fn: () => void) => mqListeners.push(fn),
  };
  const guard = <T>(fn: () => T) => { if (opts.storageThrows) throw new Error("bloqueado"); return fn(); };
  const localStorage = {
    getItem: (k: string) => guard(() => store.get(k) ?? null),
    setItem: (k: string, v: string) => guard(() => void store.set(k, v)),
    removeItem: (k: string) => guard(() => void store.delete(k)),
  };
  const document = {
    documentElement: { setAttribute: (k: string, v: string) => { attrs[k] = v; } },
    querySelectorAll: () => metas,
    addEventListener: () => {},
  };
  const window: { matchMedia: () => typeof mq; __setThemeMode?: (m: ThemeMode) => void } = { matchMedia: () => mq };
  new Function("window", "document", "localStorage", THEME_SCRIPT)(window, document, localStorage);
  return {
    attrs, metas, store, window,
    osChanges(dark: boolean) { mq.matches = dark; mqListeners.forEach((fn) => fn()); },
  };
}

describe("modo inicial", () => {
  it("sin elección guardada sigue al celular (oscuro)", () => {
    const b = fakeBrowser({ prefersDark: true });
    expect(b.attrs["data-theme"]).toBe("dark");
    expect(b.attrs["data-theme-mode"]).toBe("system");
    expect(b.metas[0].content).toBe(THEME_BAR_COLORS.dark);
  });

  it("sin elección guardada sigue al celular (claro)", () => {
    const b = fakeBrowser({ prefersDark: false });
    expect(b.attrs["data-theme"]).toBe("light");
    expect(b.metas[0].content).toBe(THEME_BAR_COLORS.light);
  });

  it("la elección guardada gana sobre el celular", () => {
    expect(fakeBrowser({ prefersDark: true, stored: "light" }).attrs["data-theme"]).toBe("light");
    expect(fakeBrowser({ prefersDark: false, stored: "dark" }).attrs["data-theme"]).toBe("dark");
  });

  it("un valor guardado raro se ignora", () => {
    const b = fakeBrowser({ prefersDark: true, stored: "violeta" });
    expect(b.attrs["data-theme"]).toBe("dark");
    expect(b.attrs["data-theme-mode"]).toBe("system");
  });

  it("si el navegador bloquea localStorage, sigue al celular sin romperse", () => {
    const b = fakeBrowser({ prefersDark: true, storageThrows: true });
    expect(b.attrs["data-theme"]).toBe("dark");
    expect(() => b.window.__setThemeMode!("light")).not.toThrow();
    expect(b.attrs["data-theme"]).toBe("light");
  });
});

describe("cambio de modo", () => {
  it("elegir claro u oscuro lo guarda; automático lo borra", () => {
    const b = fakeBrowser({ prefersDark: false });
    b.window.__setThemeMode!("dark");
    expect(b.store.get(THEME_STORAGE_KEY)).toBe("dark");
    expect(b.attrs["data-theme"]).toBe("dark");
    expect(b.attrs["data-theme-mode"]).toBe("dark");

    b.window.__setThemeMode!("system");
    expect(b.store.has(THEME_STORAGE_KEY)).toBe(false);
    expect(b.attrs["data-theme"]).toBe("light");
  });

  it("en automático acompaña el cambio del celular; con una elección fija, no", () => {
    const auto = fakeBrowser({ prefersDark: false });
    auto.osChanges(true);
    expect(auto.attrs["data-theme"]).toBe("dark");

    const fixed = fakeBrowser({ prefersDark: false, stored: "light" });
    fixed.osChanges(true);
    expect(fixed.attrs["data-theme"]).toBe("light");
  });

  it("solo se guarda la preferencia de tema", () => {
    const b = fakeBrowser({ prefersDark: false });
    b.window.__setThemeMode!("dark");
    expect([...b.store.keys()]).toEqual([THEME_STORAGE_KEY]);
  });
});
