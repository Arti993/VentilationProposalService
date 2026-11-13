/**
 * GET /api/proposal/[id] — скачать КП в DOCX.
 *
 * Сессия берётся из БД по id. Клиент не может подставить свои позиции
 * или цены: документ собирается только из того, что сохранено на сервере.
 *
 * Ответ — файл, а не JSON: браузер скачает его напрямую.
 */
import { NextResponse } from "next/server";
import { getSession } from "../../_lib/sessionStore";
import { buildProposalDocx, proposalFileName } from "@/lib/proposal/docx";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await ctx.params;

  // Формат id проверяем до запроса в БД: мусор не должен доходить до базы
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json(
      { ok: false, error: "Некорректный идентификатор сметы." },
      { status: 400 },
    );
  }

  try {
    const session = await getSession(id);

    if (!session) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Смета не найдена или срок её хранения истёк (24 часа). Загрузите файл заново.",
        },
        { status: 404 },
      );
    }

    if (!session.positions.some((p) => p.status === "priced")) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "В смете нет ни одной позиции с ценой — формировать КП не из чего. " +
            "Проверьте, что позиции есть в прайсе.",
        },
        { status: 422 },
      );
    }

    const buffer = await buildProposalDocx({ session });
    const fileName = proposalFileName();

    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="kp.docx"; filename*=UTF-8''${encodeURIComponent(
          fileName,
        )}`,
        "Content-Length": String(buffer.length),
        // Документ уникален для сессии, но кэшировать его на клиенте не нужно
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[api/proposal]", msg);
    return NextResponse.json(
      { ok: false, error: `Не удалось сформировать КП: ${msg}` },
      { status: 500 },
    );
  }
}
