import { HeaderBar, HeaderBrand } from "./HeaderLayout";

/** A prefetched shell lets navigation commit before protected data arrives. */
export function PageLoading({ title }: { title: string }) {
  return (
    <div className="min-h-screen bg-slate-50/70">
      <header className="border-b border-slate-200 bg-white/90"><HeaderBar><HeaderBrand /></HeaderBar></header>
      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-12" aria-busy="true">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
        <div className="mt-8 space-y-5" role="status">
          <span className="sr-only">Загружаем данные…</span>
          {[0, 1].map((i) => <div key={i} className="h-44 animate-pulse rounded-2xl bg-slate-200/60" aria-hidden />)}
        </div>
      </main>
    </div>
  );
}
