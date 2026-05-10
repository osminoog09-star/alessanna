import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode };

type State = { error: Error | null };

/**
 * Без границы ошибок сбой рендера даёт пустой #root при body.bg-black — «чёрный экран» без текста.
 */
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[AppErrorBoundary]", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen bg-zinc-950 px-4 py-10 text-zinc-200">
          <div className="mx-auto max-w-lg rounded-xl border border-rose-500/30 bg-rose-950/20 p-6">
            <h1 className="text-lg font-semibold text-rose-100">CRM: ошибка отображения</h1>
            <p className="mt-2 text-sm text-zinc-400">
              Обновите страницу. Если повторяется — откройте консоль (F12) и сообщите текст ошибки.
            </p>
            <pre className="mt-4 max-h-48 overflow-auto rounded-lg bg-black/40 p-3 text-xs text-rose-200/90">
              {this.state.error.message}
            </pre>
            <button
              type="button"
              className="mt-4 rounded-lg border border-zinc-600 px-4 py-2 text-sm text-zinc-200 hover:bg-zinc-800"
              onClick={() => window.location.reload()}
            >
              Обновить страницу
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
