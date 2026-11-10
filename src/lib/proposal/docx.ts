/**
 * Генерация коммерческого предложения в формате DOCX.
 *
 * Задача: менеджер должен получить документ, который можно отправить
 * клиенту, а не таблицу с непонятными статусами. Поэтому в КП попадают
 * ТОЛЬКО позиции с ценой, а остальные выносятся в отдельный блок
 * «Требует уточнения» — без цен и без внутренних объяснений.
 *
 * Принципиально: статусы, причины и уверенность модели — внутренняя
 * информация. Клиент не должен видеть «нет в прайсе» или «LLM не уверен».
 * Ему нужно знать, какие позиции он получит по какой цене и что ещё
 * уточняется.
 */
import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  convertMillimetersToTwip,
} from "docx";
import type { EstimatePosition, EstimateSession } from "@entities/estimate/model/types";

/** Реквизиты компании. В реальном проекте — из БД или настроек. */
export const COMPANY = {
  name: "ООО «ВентПром»",
  tagline: "Вентиляционное оборудование и воздуховоды",
  phone: "+7 (812) 000-00-00",
  email: "zakaz@ventprom.example",
  site: "ventprom.example",
  address: "г. Санкт-Петербург, ул. Промышленная, д. 1",
} as const;

/** Условия, которые идут в КП. Формулировки — не юридические, а рабочие. */
export const TERMS = [
  "Цены указаны в рублях с учётом НДС 20%.",
  "Срок действия предложения — 14 календарных дней с даты формирования.",
  "Срок изготовления: 5–10 рабочих дней с момента согласования заказа.",
  "Условия оплаты: 50% предоплата, 50% по факту готовности.",
  "Доставка рассчитывается отдельно, зависит от объёма и адреса.",
  "Самовывоз со склада: г. Санкт-Петербург, ул. Промышленная, д. 1.",
] as const;

const FONT = "Calibri";
const INK = "1C2028";
const MUTED = "6B7280";
const ACCENT = "D46A35";
const LINE = "D8DCE2";

/** Деньги в формате «123 170,00 ₽» — с неразрывными пробелами для Word. */
function money(value: number | undefined): string {
  if (value === undefined || value === null) return "—";
  const fixed = value.toFixed(2).replace(".", ",");
  const [int, frac] = fixed.split(",");
  const grouped = int!.replace(/\B(?=(\d{3})+(?!\d))/g, "\u00A0");
  return `${grouped},${frac}\u00A0\u20BD`;
}

function num(value: number): string {
  return Number.isInteger(value)
    ? String(value)
    : String(value).replace(".", ",");
}

function text(value: string, opts: {
  bold?: boolean;
  size?: number;
  color?: string;
  italics?: boolean;
} = {}): TextRun {
  return new TextRun({
    text: value,
    bold: opts.bold,
    italics: opts.italics,
    size: opts.size ?? 20, // половинные пункты: 20 = 10pt
    color: opts.color ?? INK,
    font: FONT,
  });
}

function cell(
  content: Paragraph[],
  opts: { width?: number; shade?: string; align?: (typeof AlignmentType)[keyof typeof AlignmentType] } = {},
): TableCell {
  return new TableCell({
    children: content,
    width: opts.width ? { size: opts.width, type: WidthType.PERCENTAGE } : undefined,
    shading: opts.shade ? { fill: opts.shade } : undefined,
    margins: {
      top: convertMillimetersToTwip(1.5),
      bottom: convertMillimetersToTwip(1.5),
      left: convertMillimetersToTwip(2),
      right: convertMillimetersToTwip(2),
    },
  });
}

function para(content: TextRun[], opts: {
  align?: (typeof AlignmentType)[keyof typeof AlignmentType];
  spaceAfter?: number;
  spaceBefore?: number;
} = {}): Paragraph {
  return new Paragraph({
    children: content,
    alignment: opts.align,
    spacing: { after: opts.spaceAfter ?? 0, before: opts.spaceBefore ?? 0 },
  });
}

const NO_BORDERS = {
  top: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  bottom: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  left: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  right: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
};

const THIN = { style: BorderStyle.SINGLE, size: 4, color: LINE };

/** Шапка: реквизиты слева, заголовок справа. */
function header(proposalNo: string, dateStr: string): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: NO_BORDERS,
    rows: [
      new TableRow({
        children: [
          cell(
            [
              para([text(COMPANY.name, { bold: true, size: 28 })]),
              para([text(COMPANY.tagline, { size: 18, color: MUTED })], { spaceBefore: 40 }),
              para([text(`${COMPANY.phone}  ·  ${COMPANY.email}`, { size: 18, color: MUTED })], {
                spaceBefore: 40,
              }),
            ],
            { width: 55 },
          ),
          cell(
            [
              para([text("КОММЕРЧЕСКОЕ ПРЕДЛОЖЕНИЕ", { bold: true, size: 24 })], {
                align: AlignmentType.RIGHT,
              }),
              para([text(`№ ${proposalNo} от ${dateStr}`, { size: 18, color: MUTED })], {
                align: AlignmentType.RIGHT,
                spaceBefore: 60,
              }),
            ],
            { width: 45 },
          ),
        ],
      }),
    ],
  });
}

/** Таблица позиций с ценой. */
function pricedTable(positions: EstimatePosition[]): Table {
  const headerCells = [
    cell([para([text("№", { bold: true, size: 18, color: "FFFFFF" })])], {
      width: 6,
      shade: INK,
    }),
    cell([para([text("Наименование", { bold: true, size: 18, color: "FFFFFF" })])], {
      width: 46,
      shade: INK,
    }),
    cell([para([text("Кол-во", { bold: true, size: 18, color: "FFFFFF" })], {
      align: AlignmentType.RIGHT,
    })], { width: 10, shade: INK }),
    cell([para([text("Ед.", { bold: true, size: 18, color: "FFFFFF" })])], {
      width: 8,
      shade: INK,
    }),
    cell([para([text("Цена, ₽", { bold: true, size: 18, color: "FFFFFF" })], {
      align: AlignmentType.RIGHT,
    })], { width: 15, shade: INK }),
    cell([para([text("Сумма, ₽", { bold: true, size: 18, color: "FFFFFF" })], {
      align: AlignmentType.RIGHT,
    })], { width: 15, shade: INK }),
  ];

  const rows = [
    new TableRow({ children: headerCells, tableHeader: true }),
    ...positions.map((p, i) => {
      // Для клиента название — как в прайсе: это то, что он получит.
      // Название из его сметы может быть неточным.
      const name = p.matchedName ?? p.name;
      const shade = i % 2 === 1 ? "F6F7F9" : undefined;

      return new TableRow({
        children: [
          cell([para([text(String(p.posNo), { size: 18, color: MUTED })])], { shade, width: 6 }),
          cell([para([text(name, { size: 18 })])], { shade, width: 46 }),
          cell([para([text(num(p.qty), { size: 18 })], { align: AlignmentType.RIGHT })], {
            shade,
            width: 10,
          }),
          cell([para([text(p.unit ?? "шт", { size: 18, color: MUTED })])], { shade, width: 8 }),
          cell([para([text(money(p.unitPrice), { size: 18 })], { align: AlignmentType.RIGHT })], {
            shade,
            width: 15,
          }),
          cell([para([text(money(p.total), { size: 18, bold: true })], {
            align: AlignmentType.RIGHT,
          })], { shade, width: 15 }),
        ],
      });
    }),
  ];

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: THIN,
      bottom: THIN,
      left: NO_BORDERS.left,
      right: NO_BORDERS.right,
      insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: LINE },
      insideVertical: NO_BORDERS.left,
    },
    rows,
  });
}

/** Итоговая строка: подпись слева, сумма справа. */
function totalRow(total: number, count: number): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 8, color: INK },
      bottom: NO_BORDERS.bottom,
      left: NO_BORDERS.left,
      right: NO_BORDERS.right,
    },
    rows: [
      new TableRow({
        children: [
          cell(
            [
              para([text(`Итого по ${count} позициям`, { bold: true, size: 20 })], {
                align: AlignmentType.RIGHT,
              }),
            ],
            { width: 76 },
          ),
          cell([para([text(money(total), { bold: true, size: 24 })], {
            align: AlignmentType.RIGHT,
          })], { width: 24 }),
        ],
      }),
    ],
  });
}

/**
 * Блок уточняемых позиций.
 *
 * Только названия и количество — никаких статусов и объяснений.
 * Формулировка «уточняется» честно говорит клиенту, что позиция в работе,
 * и не выдаёт внутреннюю кухню матчера.
 */
function pendingBlock(positions: EstimatePosition[]): Paragraph[] {
  if (!positions.length) return [];

  return [
    new Paragraph({
      children: [text("Позиции, требующие уточнения", { bold: true, size: 22 })],
      spacing: { before: 320, after: 120 },
    }),
    new Paragraph({
      children: [
        text(
          "По перечисленным позициям цена уточняется и будет направлена отдельным сообщением. " +
            "В итоговую сумму они не включены.",
          { size: 18, color: MUTED },
        ),
      ],
      spacing: { after: 160 },
    }),
    ...positions.map(
      (p) =>
        new Paragraph({
          children: [
            text(`${p.posNo}. `, { size: 18, color: MUTED }),
            text(p.name, { size: 18 }),
            text(` — ${num(p.qty)} ${p.unit ?? "шт"}`, { size: 18, color: MUTED }),
          ],
          spacing: { after: 60 },
        }),
    ),
  ];
}

export interface BuildProposalOptions {
  session: EstimateSession;
  /** Номер предложения. По умолчанию — из даты и id сессии. */
  proposalNo?: string;
  /** Куда адресовано: «Для: ООО Ромашка». Необязательно. */
  customer?: string;
}

/** Собирает документ КП. Возвращает Buffer с .docx. */
export async function buildProposalDocx(
  opts: BuildProposalOptions,
): Promise<Buffer> {
  const { session } = opts;
  const now = new Date();
  const dateStr = now.toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

  const proposalNo =
    opts.proposalNo ??
    `${String(now.getFullYear()).slice(2)}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
      now.getDate(),
    ).padStart(2, "0")}`;

  const priced = session.positions.filter((p) => p.status === "priced");
  const pending = session.positions.filter(
    (p) => p.status !== "priced" && p.status !== "off_topic",
  );

  const children: Array<Paragraph | Table> = [
    header(proposalNo, dateStr),
    new Paragraph({ text: "", spacing: { after: 240 } }),

    new Paragraph({
      children: [text("Уважаемые коллеги!", { size: 20 })],
      spacing: { after: 120 },
    }),
    new Paragraph({
      children: [
        text(
          "Благодарим за обращение. Направляем коммерческое предложение на поставку " +
            "вентиляционного оборудования согласно вашей заявке.",
          { size: 20 },
        ),
      ],
      spacing: { after: 200 },
    }),
  ];

  if (opts.customer) {
    children.push(
      new Paragraph({
        children: [
          text("Заказчик: ", { bold: true, size: 20 }),
          text(opts.customer, { size: 20 }),
        ],
        spacing: { after: 200 },
      }),
    );
  }

  children.push(
    new Paragraph({
      children: [text("Спецификация", { bold: true, size: 22 })],
      spacing: { after: 160 },
    }),
    pricedTable(priced),
    new Paragraph({ text: "", spacing: { after: 80 } }),
    totalRow(session.stats.totalSum, priced.length),
  );

  // Уточняемые позиции
  if (pending.length) {
    children.push(...pendingBlock(pending));
  }

  // Условия
  children.push(
    new Paragraph({
      children: [text("Условия сотрудничества", { bold: true, size: 22 })],
      spacing: { before: 400, after: 160 },
    }),
    ...TERMS.map(
      (t) =>
        new Paragraph({
          children: [text(`•  ${t}`, { size: 18 })],
          spacing: { after: 80 },
          indent: { left: convertMillimetersToTwip(2) },
        }),
    ),
  );

  // Подпись
  children.push(
    new Paragraph({ text: "", spacing: { after: 400 } }),
    new Paragraph({
      children: [text("С уважением, отдел продаж", { size: 20 })],
      spacing: { after: 60 },
    }),
    new Paragraph({
      children: [text(`${COMPANY.name}  ·  ${COMPANY.phone}`, { size: 18, color: MUTED })],
      spacing: { after: 60 },
    }),
    new Paragraph({
      children: [text(`${COMPANY.email}  ·  ${COMPANY.site}`, { size: 18, color: MUTED })],
    }),
  );

  const doc = new Document({
    creator: COMPANY.name,
    title: `Коммерческое предложение № ${proposalNo}`,
    description: `КП по смете «${session.name}»`,
    styles: {
      default: {
        document: {
          run: { font: FONT, size: 20, color: INK },
          paragraph: { spacing: { line: 276 } },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: convertMillimetersToTwip(18),
              right: convertMillimetersToTwip(18),
              bottom: convertMillimetersToTwip(18),
              left: convertMillimetersToTwip(22),
            },
          },
        },
        children,
      },
    ],
  });

  return Packer.toBuffer(doc);
}

/** Имя файла для скачивания. Без пользовательских данных в пути. */
export function proposalFileName(proposalNo?: string): string {
  const n =
    proposalNo ??
    new Date().toISOString().slice(0, 10);
  return `КП-${n}.docx`;
}

export { HeadingLevel };
