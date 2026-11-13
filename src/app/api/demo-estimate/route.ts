/**
 * GET /api/demo-estimate — текст демонстрационной сметы.
 *
 * Нужен для кнопки «Попробовать на примере»: пользователь не должен
 * искать файл, чтобы увидеть, как работает сервис.
 *
 * ВАЖНО про деплой: примеры читаются импортом, а не с диска через fs.
 * На Vercel файлы не попадают в бандл функции автоматически, и
 * `fs.readFileSync(process.cwd() + ...)` вернул бы ENOENT уже в проде.
 * Импорт встраивает текст в сборку — работает везде одинаково.
 */
import { NextResponse } from "next/server";
import officeEstimate from "../../../../examples/estimate-office.txt";
import warehouseEstimate from "../../../../examples/estimate-warehouse.csv";

export const runtime = "nodejs";

const DEMO_FILES: Record<string, { fileName: string; content: string }> = {
  office: { fileName: "estimate-office.txt", content: officeEstimate },
  warehouse: { fileName: "estimate-warehouse.csv", content: warehouseEstimate },
};

export async function GET(req: Request): Promise<NextResponse> {
  const which = new URL(req.url).searchParams.get("file") ?? "office";
  const demo = DEMO_FILES[which];

  if (!demo) {
    return NextResponse.json(
      { ok: false, error: `Нет такого примера. Доступно: ${Object.keys(DEMO_FILES).join(", ")}` },
      { status: 404 },
    );
  }

  if (!demo.content || demo.content.length < 20) {
    return NextResponse.json(
      { ok: false, error: "Файл примера пуст" },
      { status: 500 },
    );
  }

  return new NextResponse(demo.content, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `inline; filename="${demo.fileName}"`,
    },
  });
}
