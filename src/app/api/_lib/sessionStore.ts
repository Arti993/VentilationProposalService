/**
 * Серверное хранилище сессий.
 *
 * Проблема: браузер загружает смету одним запросом, а спрашивает про неё
 * другим. Нужно, чтобы сервер «помнил» смету между запросами.
 *
 * Решения, которые НЕ подходят:
 *  - глобальная переменная: на Vercel каждый запрос может попасть в другой
 *    инстанс функции, память не разделяется;
 *  - отправлять всю смету с каждым вопросом: раздувает запрос и позволяет
 *    клиенту подменить цены;
 *  - Redis/Postgres: правильно для продакшена, но сейчас это лишняя
 *    инфраструктура для учебного проекта.
 *
 * Что делаем: Map в памяти инстанса + TTL. На Vercel это будет работать
 * с оговоркой: при холодном старте или переходе на другой инстанс сессия
 * потеряется, и пользователь увидит «смета не найдена» — не молчаливую
 * ошибку, а честное сообщение. Для демо это приемлемо и явно задокументировано.
 *
 * ВАЖНО: цены здесь уже зафиксированы матчером. Клиент не может их изменить:
 * он присылает только ID сессии, а не данные.
 */
import type { EstimateSession } from "@entities/estimate/model/types";

interface StoredSession {
  session: EstimateSession;
  expiresAt: number;
}

/** Время жизни сессии: 1 час. Дольше — пользователь перезагружает смету. */
const TTL_MS = 60 * 60 * 1000;

/**
 * Хранилище на globalThis: в dev-режиме Next.js перезагружает модули при
 * каждом изменении файла, и обычная переменная модуля обнулилась бы.
 */
const globalStore = globalThis as unknown as {
  __estimateSessions?: Map<string, StoredSession>;
};

function store(): Map<string, StoredSession> {
  if (!globalStore.__estimateSessions) {
    globalStore.__estimateSessions = new Map();
  }
  return globalStore.__estimateSessions;
}

/** Криптостойкий ID: предсказуемый ID позволил бы читать чужие сметы. */
export function createSessionId(): string {
  return crypto.randomUUID();
}

export function saveSession(id: string, session: EstimateSession): void {
  cleanup();
  store().set(id, { session, expiresAt: Date.now() + TTL_MS });
}

export function getSession(id: string): EstimateSession | null {
  const entry = store().get(id);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    store().delete(id);
    return null;
  }
  return entry.session;
}

/** Удаляет протухшие сессии, чтобы Map не рос бесконечно. */
function cleanup(): void {
  const now = Date.now();
  for (const [id, entry] of store().entries()) {
    if (now > entry.expiresAt) store().delete(id);
  }
}
