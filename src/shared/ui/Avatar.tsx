import { cn } from "@shared/lib/cn";

/**
 * Круглая аватарка: картинка либо инициалы.
 *
 * ПОЧЕМУ ОТДЕЛЬНЫЙ КОМПОНЕНТ
 *
 * Аватар нужен минимум в двух местах — в шапке и в кабинете, — и в обоих
 * он должен выглядеть одинаково. Копия разметки в двух файлах рано или
 * поздно разъедется: в шапке появится рамка, в кабинете нет, и человек
 * не поймёт, какая из двух «настоящая».
 *
 * ПОЧЕМУ ИНИЦИАЛЫ, А НЕ ЗАГЛУШКА-СИЛУЭТ
 *
 * У большинства пользователей картинки не будет — её надо ещё загрузить.
 * Серый силуэт на каждом экране читается как «здесь что-то не работает».
 * Буквы имени, наоборот, выглядят намеренно и заодно помогают узнать
 * себя в списке.
 */
export interface AvatarProps {
  /** Картинка: data URL или ссылка. `null` — показываем инициалы. */
  image: string | null;
  /** Имя — из него берём буквы */
  name: string;
  /**
   * Размер в пикселях. Передаём числом, а не классом: Tailwind не умеет
   * собирать `h-${n}` динамически, а инлайновый стиль здесь честнее
   * десятка условных классов.
   */
  size?: number;
  className?: string;
}

/**
 * Две первые буквы имени: «Артём Симонов» → «АС», «Артём» → «Ар».
 *
 * Берём по первой букве первого и последнего слова, а не первых двух:
 * «Артём Симонов» и «Анна Смирнова» иначе дали бы одинаковое «Ар».
 * `slice(0, 2)` нужен для однобуквенных имён и для emoji: без него
 * `Array.from` вернёт одну букву и кружок останется полупустым.
 */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : (parts[0]?.[1] ?? "");
  return (first + last).toUpperCase().slice(0, 2);
}

export function Avatar({ image, name, size = 32, className }: AvatarProps) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-accent-100 text-accent-700 ring-1 ring-inset ring-accent-600/10",
        className,
      )}
      style={{ width: size, height: size }}
    >
      {image ? (
        /*
          `object-cover` — то самое «обрезанное в виде круга»: картинка
          заполняет круг целиком и обрезается по краям, а не сплющивается
          в овал. `alt=""` + `aria-hidden`: имя рядом уже озвучено, и
          скринридер не должен читать его дважды.
        */
        <img
          src={image}
          alt=""
          aria-hidden
          className="h-full w-full object-cover"
          width={size}
          height={size}
        />
      ) : (
        <span
          className="text-[0.7em] font-semibold leading-none"
          style={{ fontSize: Math.max(11, size * 0.38) }}
          aria-hidden
        >
          {initialsOf(name)}
        </span>
      )}
    </span>
  );
}