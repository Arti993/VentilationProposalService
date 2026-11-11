/**
 * Проверяет модель эмбеддингов: размерность, стоимость, время.
 *
 * Запуск: node --env-file=.env.local scripts/check-embed.ts
 */
import { closeQuietly } from "../src/db/connection.ts";

const BASE = process.env.POLZA_BASE_URL ?? "https://polza.ai/api/v1";
const KEY = process.env.POLZA_API_KEY ?? "";
const MODEL = process.env.EMBED_MODEL ?? "baai/bge-m3";

async function embed(input: string[]): Promise<number[][]> {
  const res = await fetch(`${BASE}/embeddings`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: MODEL, input }),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const json = (await res.json()) as {
    data: Array<{ embedding: number[]; index: number }>;
    usage?: { total_tokens?: number };
  };
  return json.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
}

async function main() {
  console.log("Модель:", MODEL);

  const start = Date.now();
  const vectors = await embed([
    "Воздуховод спирально-навивной 315",
    "Тройник вентиляционный круглый 315/200",
    "Отвод сегментный 90 градусов 315",
  ]);
  const ms = Date.now() - start;

  console.log("Векторов:", vectors.length);
  console.log("Размерность:", vectors[0]!.length);
  console.log("Время:", ms, "мс");
  console.log("Первые 5 значений:", vectors[0]!.slice(0, 5).map((v) => v.toFixed(4)).join(", "));

  // Нормализованы ли: если да, косинус = скалярное произведение (быстрее)
  const norm = Math.sqrt(vectors[0]!.reduce((s, v) => s + v * v, 0));
  console.log("Норма вектора:", norm.toFixed(4), norm > 0.99 && norm < 1.01 ? "(нормализован)" : "(не нормирован)");

  // Проверим, что близкие по смыслу ближе, чем далёкие
  const cos = (a: number[], b: number[]) => {
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) { dot += a[i]! * b[i]!; na += a[i]! ** 2; nb += b[i]! ** 2; }
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
  };

  const [duct, tee, elbow] = vectors as [number[], number[], number[]];
  const other = await embed(["Тройник вентиляционный круглый 400/315"]);
  console.log("\nБлизость:");
  console.log("  тройник 315/200 ↔ тройник 400/315:", cos(tee, other[0]!).toFixed(4));
  console.log("  воздуховод ↔ тройник 315/200:     ", cos(duct, tee).toFixed(4));
  console.log("  воздуховод ↔ тройник 400/315:     ", cos(duct, other[0]!).toFixed(4));
  console.log("  отвод ↔ тройник 315/200:          ", cos(elbow, tee).toFixed(4));
}

main()
  .catch((e) => {
    console.error("ОШИБКА:", e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => {
    void closeQuietly;
  });
