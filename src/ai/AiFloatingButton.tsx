/**
 * Floating launcher button for the AI assistant panel.
 *
 * Always visible (except when the panel is already open) so the user has a
 * mouse-driven way to open the AI assistant in addition to the Cmd/Ctrl+J
 * keyboard shortcut (PRD M10+ — "悬浮窗的小按钮打开而不只是 Ctrl+J").
 *
 * Rendered in App.tsx as a sibling of <AiPanel/> — App owns the open/close
 * state, this component just calls onOpen when clicked and stays hidden
 * while the panel is mounted.
 */

import { useTranslation } from 'react-i18next';

interface Props {
  onOpen: () => void;
}

export function AiFloatingButton({ onOpen }: Props) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={t('ai.floatingButtonLabel')}
      title={t('ai.floatingButtonTitle')}
      className="fixed bottom-5 right-5 z-[1000] flex h-11 w-11 items-center justify-center rounded-full bg-accent text-white shadow-popover transition-all hover:bg-accent-hover hover:scale-105 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-page"
    >
      {/* Sparkle icon — same idiom used by Notion / Linear / ChatGPT for AI
          entry points. Inline SVG to avoid pulling an icon dependency. */}
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z" />
        <path d="M19 14l.7 1.9L21.5 17l-1.9.7L19 19.5l-.7-1.9L16.5 17l1.9-.7L19 14z" />
      </svg>
    </button>
  );
}
