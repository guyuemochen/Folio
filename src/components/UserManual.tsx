import { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../lib/theme';

/**
 * Standalone user-manual view rendered in its own OS window
 * (Tauri `WebviewWindow`, label `manual`).
 *
 * Routing: `src/main.tsx` branches on `window.location.hash === '#manual'`
 * and mounts this component instead of <App/>. The window is created from
 * `src/lib/openManual.ts`, which loads the same `index.html` with the
 * `#manual` hash so the same bundle serves both the app and the manual
 * (no second HTML entry, no server-side route fallback needed — important
 * because Tauri's production asset protocol does not fallback to
 * index.html for unknown paths).
 *
 * All copy is driven by i18next (`manual.*` namespace) so the manual
 * follows the user's display language (zh-CN / en) and theme tokens.
 */

const SECTIONS = [
  { id: 'getting-started', titleKey: 'manual.gettingStarted.title' },
  { id: 'pages', titleKey: 'manual.pages.title' },
  { id: 'editor', titleKey: 'manual.editor.title' },
  { id: 'search', titleKey: 'manual.search.title' },
  { id: 'database', titleKey: 'manual.database.title' },
  { id: 'import-export', titleKey: 'manual.importExport.title' },
  { id: 'ai', titleKey: 'manual.ai.title' },
  { id: 'shortcuts', titleKey: 'manual.shortcuts.title' },
  { id: 'data-privacy', titleKey: 'manual.dataPrivacy.title' },
] as const;

/** Shortcut table rows. `keys` are rendered verbatim (no translation). */
const SHORTCUTS: { keys: string[]; labelKey: string }[] = [
  { keys: ['Ctrl', 'N'], labelKey: 'manual.shortcuts.newPage' },
  { keys: ['Ctrl', 'K'], labelKey: 'manual.shortcuts.search' },
  { keys: ['Ctrl', 'J'], labelKey: 'manual.shortcuts.aiPanel' },
  { keys: ['Ctrl', 'F'], labelKey: 'manual.shortcuts.editorFind' },
  { keys: ['/', 'Space'], labelKey: 'manual.shortcuts.slashMenu' },
  { keys: ['Ctrl', 'Enter'], labelKey: 'manual.shortcuts.saveTitle' },
  { keys: ['Shift', 'Paste'], labelKey: 'manual.shortcuts.plainPaste' },
];

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex items-center justify-center min-w-[24px] h-6 px-1.5 rounded border border-border-hairline bg-bg-section text-[12px] font-mono text-text-primary shadow-[0_1px_0_var(--color-border-hairline)]">
      {children}
    </kbd>
  );
}

function ShortcutKeys({ keys }: { keys: string[] }) {
  return (
    <span className="inline-flex items-center gap-1">
      {keys.map((k, i) => (
        <span key={k} className="flex items-center gap-1">
          {i > 0 && <span className="text-text-tertiary text-[11px]">+</span>}
          <Kbd>{k}</Kbd>
        </span>
      ))}
    </span>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-6 mb-12">
      <h2 className="text-h2 mb-3">{title}</h2>
      <div className="space-y-3 text-[14px] leading-relaxed text-text-secondary">{children}</div>
    </section>
  );
}

/** Bullet list helper to keep section bodies compact. */
function Bullets({ items }: { items: ReactNode[] }) {
  return (
    <ul className="space-y-1.5 pl-5 list-disc marker:text-text-tertiary">
      {items.map((it, i) => (
        <li key={i} className="text-text-secondary">
          {it}
        </li>
      ))}
    </ul>
  );
}

export function UserManual() {
  const { t } = useTranslation();
  // Keep the manual window in sync with OS color-scheme changes too — the
  // app shell wires this in <App/>, but the manual window doesn't mount <App/>.
  useTheme();

  return (
    <div className="flex h-screen bg-bg-page text-text-primary font-sans">
      {/* === Sticky table of contents === */}
      <nav className="w-56 shrink-0 border-r border-border-hairline overflow-y-auto p-4 sticky top-0 h-screen">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary mb-3">
          {t('manual.toc')}
        </h2>
        <ul className="space-y-0.5">
          {SECTIONS.map((s, i) => (
            <li key={s.id}>
              <a
                href={`#${s.id}`}
                className="block px-2 py-1 text-[13px] rounded text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors"
              >
                <span className="text-text-tertiary mr-1.5">{i + 1}.</span>
                {t(s.titleKey)}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      {/* === Scrollable content === */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-10 py-12">
          <h1 className="text-[32px] font-semibold leading-tight mb-2">{t('manual.title')}</h1>
          <p className="text-[14px] text-text-secondary mb-10">{t('manual.subtitle')}</p>

          <Section id="getting-started" title={t('manual.gettingStarted.title')}>
            <p>{t('manual.gettingStarted.p1')}</p>
            <Bullets
              items={[
                t('manual.gettingStarted.b1'),
                t('manual.gettingStarted.b2'),
                t('manual.gettingStarted.b3'),
              ]}
            />
            <p className="text-text-tertiary text-[13px]">{t('manual.gettingStarted.tip')}</p>
          </Section>

          <Section id="pages" title={t('manual.pages.title')}>
            <p>{t('manual.pages.p1')}</p>
            <Bullets
              items={[
                t('manual.pages.b1'),
                t('manual.pages.b2'),
                t('manual.pages.b3'),
                t('manual.pages.b4'),
              ]}
            />
          </Section>

          <Section id="editor" title={t('manual.editor.title')}>
            <p>{t('manual.editor.p1')}</p>
            <Bullets
              items={[
                t('manual.editor.b1'),
                t('manual.editor.b2'),
                t('manual.editor.b3'),
                t('manual.editor.b4'),
                t('manual.editor.b5'),
              ]}
            />
          </Section>

          <Section id="search" title={t('manual.search.title')}>
            <p>{t('manual.search.p1')}</p>
            <p>
              <ShortcutKeys keys={['Ctrl', 'K']} /> <span className="ml-2">{t('manual.search.hint')}</span>
            </p>
          </Section>

          <Section id="database" title={t('manual.database.title')}>
            <p>{t('manual.database.p1')}</p>
            <Bullets
              items={[
                t('manual.database.b1'),
                t('manual.database.b2'),
                t('manual.database.b3'),
              ]}
            />
          </Section>

          <Section id="import-export" title={t('manual.importExport.title')}>
            <p>{t('manual.importExport.p1')}</p>
            <Bullets
              items={[
                t('manual.importExport.b1'),
                t('manual.importExport.b2'),
                t('manual.importExport.b3'),
              ]}
            />
          </Section>

          <Section id="ai" title={t('manual.ai.title')}>
            <p>{t('manual.ai.p1')}</p>
            <Bullets
              items={[
                t('manual.ai.b1'),
                t('manual.ai.b2'),
                t('manual.ai.b3'),
              ]}
            />
            <p className="text-text-tertiary text-[13px]">{t('manual.ai.privacy')}</p>
          </Section>

          <Section id="shortcuts" title={t('manual.shortcuts.title')}>
            <p>{t('manual.shortcuts.desc')}</p>
            <table className="w-full text-[13px] border-collapse">
              <tbody>
                {SHORTCUTS.map((s) => (
                  <tr key={s.labelKey} className="border-b border-border-hairline last:border-0">
                    <td className="py-2 pr-4 w-1/3 align-middle">
                      <ShortcutKeys keys={s.keys} />
                    </td>
                    <td className="py-2 text-text-secondary">{t(s.labelKey)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>

          <Section id="data-privacy" title={t('manual.dataPrivacy.title')}>
            <p>{t('manual.dataPrivacy.p1')}</p>
            <Bullets
              items={[
                t('manual.dataPrivacy.b1'),
                t('manual.dataPrivacy.b2'),
                t('manual.dataPrivacy.b3'),
              ]}
            />
          </Section>

          <footer className="mt-16 pt-6 border-t border-border-hairline text-[12px] text-text-tertiary">
            {t('manual.footer')}
          </footer>
        </div>
      </main>
    </div>
  );
}
