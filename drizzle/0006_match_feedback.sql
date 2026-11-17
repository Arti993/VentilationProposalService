-- Обратная связь менеджера по спорным позициям.
--
-- Каждая строка — обучающий пример: «клиент написал так, а имел в виду
-- вот эту позицию прайса». Из этих пар складываются синонимы и датасет
-- для eval. Без записи такой опыт теряется: менеджер исправляет КП и
-- уходит, а система спотыкается о то же слово в следующий раз.
--
-- Применяется скриптом scripts/apply-migration-0006.ts: DDL идёт напрямую
-- через withRetry, потому что `drizzle-kit migrate` зависает на пулере Neon.

create table if not exists match_feedback (
  id serial primary key,
  org_id text not null,
  estimate_id text,
  pos_no integer,
  raw_text text not null,
  guess_code text,
  chosen_code text,
  note text,
  status text not null default 'new',
  created_at timestamptz not null default now()
);

-- Список «что разобрать» в кабинете менеджера: сначала новые
create index if not exists match_feedback_org_idx
  on match_feedback (org_id, created_at);

create index if not exists match_feedback_status_idx
  on match_feedback (status);

-- Одна позиция — одна запись: повторная правка обновляет, а не плодит дубли.
-- Без этого индекса двойной клик по «сохранить» давал две строки, и
-- следующий разбор учитывал бы один случай дважды.
create unique index if not exists match_feedback_org_estimate_pos_uq
  on match_feedback (org_id, estimate_id, pos_no);
