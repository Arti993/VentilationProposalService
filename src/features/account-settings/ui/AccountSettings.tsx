"use client";

/**
 * Настройки аккаунта: имя, аватар, выход.
 *
 * ЧТО ЗДЕСЬ ЕСТЬ И ПОЧЕМУ
 *
 * Раньше имя задавалось один раз при регистрации и поменять его было
 * нельзя: в шапке показывалась почта, потому что имя не редактировалось.
 * Аватара не было вовсе.
 *
 * Теперь это единственное место, где меняется «как меня видят»:
 *
 *  - имя — попадает в шапку и в документы;
 *  - аватар — круглая картинка в шапке;
 *  - выход — переехал сюда из шапки, где он занимал место постоянно,
 *    хотя нужен раз в месяц.
 *
 * ПОЧЕМУ АВАТАР СЖИМАЕТСЯ В БРАУЗЕРЕ
 *
 * Файл с телефона — 3–5 МБ. Отправлять его на сервер значит гонять мегабайты
 * по мобильной сети ради картинки 32×32 в шапке. `canvas` уменьшает её до
 * 128×128 и кодирует в JPEG: 6–15 КБ вместо мегабайтов, и сервер получает
 * готовую строку, не занимаясь обработкой изображений.
 *
 * Обрезка квадратная и по центру — ровно то, что нужно круглой рамке:
 * иначе портрет «с головой у края» превратился бы в полосу.
 */
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, Loader2, LogOut, Trash2 } from "lucide-react";
import { Avatar } from "@shared/ui/Avatar";
import { signOut, updateProfile } from "@features/auth/api/client";

export interface AccountSettingsProps {
  initialName: string;
  initialImage: string | null;
  email: string;
}

/** Размер стороны аватара в пикселях: с запасом под retina-экраны. */
const AVATAR_SIZE = 128;

/**
 * Квадратная обрезка по центру + сжатие в JPEG.
 *
 * `createImageBitmap` понимает HEIC и EXIF-поворот в современных
 * браузерах; если он недоступен (старый Safari), падаем на обычный
 * `<img>` — картинка может повернуться боком, но загрузится.
 */
async function toAvatarDataUrl(file: File): Promise<string> {
  let source: CanvasImageSource;
  let width = 0;
  let height = 0;

  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    source = bitmap;
    width = bitmap.width;
    height = bitmap.height;
  } catch {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error("Не удалось открыть изображение. Выберите другой файл."));
        el.src = url;
      });
      source = img;
      width = img.naturalWidth;
      height = img.naturalHeight;
    } finally {
      // Освобождаем ссылку: иначе файл висит в памяти до перезагрузки
      URL.revokeObjectURL(url);
    }
  }

  const canvas = document.createElement("canvas");
  canvas.width = AVATAR_SIZE;
  canvas.height = AVATAR_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Не удалось обработать изображение. Попробуйте другой браузер.");

  const side = Math.min(width, height);
  const sx = (width - side) / 2;
  const sy = (height - side) / 2;
  ctx.drawImage(source, sx, sy, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);

  return canvas.toDataURL("image/jpeg", 0.85);
}

export function AccountSettings({ initialName, initialImage, email }: AccountSettingsProps) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState(initialName);
  const [image, setImage] = useState<string | null>(initialImage);
  const [busy, setBusy] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  /**
   * «Сохранено» гаснет само.
   *
   * Иначе зелёная плашка висит, пока человек не уйдёт со страницы, и
   * через минуту уже непонятно, к какому действию она относилась.
   */
  useEffect(() => {
    if (!saved) return;
    const t = setTimeout(() => setSaved(false), 3000);
    return () => clearTimeout(t);
  }, [saved]);

  async function pickAvatar(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError(null);
    setSaved(false);
    setProcessing(true);
    try {
      if (!file.type.startsWith("image/")) {
        setError("Выберите изображение в формате PNG, JPEG или WebP.");
        return;
      }
      setImage(await toAvatarDataUrl(file));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось обработать изображение. Выберите другой файл.");
    } finally {
      setProcessing(false);
      // Сбрасываем input: иначе повторный выбор того же файла не сработает
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function save() {
    if (busy) return;
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      setError("Укажите имя длиной от 2 символов.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const changed: { name?: string; image?: string | null } = {};
      if (trimmed !== initialName) changed.name = trimmed;
      if (image !== initialImage) changed.image = image;

      if (Object.keys(changed).length === 0) {
        setSaved(true);
        return;
      }

      const result = await updateProfile(changed);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSaved(true);
      /**
       * `refresh()` — чтобы шапка перечитала имя и аватар с сервера.
       * Cookie сессии обновлена библиотекой, но серверные компоненты
       * держат уже отрендеренный результат.
       */
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function leave() {
    setBusy(true);
    try {
      await signOut();
      // Полная перезагрузка: состояние сметы и чата в памяти не должно
      // пережить смену пользователя
      window.location.assign("/");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* ── Профиль ─────────────────────────────────────── */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <h2 className="text-base font-semibold text-slate-900">Профиль</h2>


        <div className="mt-5 flex flex-col gap-5 sm:flex-row sm:items-start">
          <div className="flex flex-col items-center gap-2">
            <Avatar image={image} name={name || email} size={72} />
            <div className="flex items-center gap-1">
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={pickAvatar}
                className="sr-only"
                id="avatar-file"
              />
              <label
                htmlFor="avatar-file"
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-accent-700 transition-colors hover:bg-accent-50"
              >
                {processing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : (
                  <Camera className="h-3.5 w-3.5" aria-hidden />
                )}
                {processing ? "Обработка…" : "Изменить"}
              </label>
              {image && (
                <button
                  type="button"
                  onClick={() => {
                    setImage(null);
                    setSaved(false);
                  }}
                  className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-red-600"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden /> Удалить фото </button>
              )}
            </div>
          </div>

          <div className="min-w-0 flex-1 space-y-4">
            <div>
              <label htmlFor="account-name" className="block text-sm font-medium text-slate-700">
                Имя
              </label>
              <input
                id="account-name"
                type="text"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setSaved(false);
                }}
                autoComplete="name"
                className="mt-1.5 block w-full max-w-md rounded-lg border border-slate-300 px-3 py-2.5 text-slate-900 placeholder:text-slate-400 focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-100"
                placeholder="Как к вам обращаться"
              />
            </div>

            <div>
              <span className="block text-sm font-medium text-slate-700">Почта</span>
              <p className="mt-1.5 text-sm text-slate-600">{email}</p>
              {/*
                Почта не редактируется здесь намеренно: смена адреса
                требует подтверждения по письму, а почтового провайдера у
                проекта пока нет. Поле «введите новый адрес», которое
                молча ничего не делает, хуже, чем его отсутствие.
              */}

            </div>

            {error && (
              <p role="alert" className="rounded-lg bg-red-50 px-3 py-2.5 text-sm text-red-700">
                {error}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={save}
                disabled={busy || processing}
                className="btn-primary gap-2 px-4 py-2.5 text-sm disabled:opacity-60"
              >
                {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                Сохранить
              </button>
              {saved && (
                <span role="status" className="text-sm font-medium text-emerald-700">
                  Сохранено
                </span>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ── Выход ───────────────────────────────────────── */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <h2 className="text-base font-semibold text-slate-900">Выход из аккаунта</h2>

        <button
          type="button"
          onClick={leave}
          disabled={busy}
          className="mt-4 inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-800 transition-colors hover:border-red-300 hover:bg-red-50 hover:text-red-700 disabled:opacity-60"
        >
          <LogOut className="h-4 w-4" aria-hidden />
          Выйти из аккаунта
        </button>
      </section>
    </div>
  );
}