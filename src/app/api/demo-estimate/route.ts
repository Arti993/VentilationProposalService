/**
 * GET /api/demo-estimate — текст демонстрационной сметы.
 *
 * Нужен для кнопки «Попробовать на примере»: пользователь не должен
 * искать файл, чтобы увидеть, как работает сервис. Файл читается с
 * диска сервера — клиент его не подменяет.
 */
import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const DEMO_FILES: Record<string, string> = {
  office: "estimate-office.txt",
  warehouse: "estimate-warehouse.csv",
};

export async function GET(req: Request): Promise<NextResponse> {
  const which = new URL(req.url).searchParams.get("file") ?? "office";
  const fileName = DEMO_FILES[which];

  if (!fileName) {
    return NextResponse.json(
      { ok: false, error: `Нет такого примера. Доступно: ${Object.keys(DEMO_FILES).join(", ")}` },
      { status: 404 },
    );
  }

  const file = path.join(process.cwd(), "examples", fileName);
  if (!fs.existsSync(file)) {
    return NextResponse.json(
      { ok: false, error: "Файл примера не найден на сервере" },
      { status: 500 },
    );
  }

  const text = fs.readFileSync(file, "utf8");
  return new NextResponse(text, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `inline; filename="${fileName}"`,
    },
  });
}
