-- Включение pgvector и колонка эмбеддингов.
--
-- pgvector — расширение Postgres для хранения векторов и поиска по
-- косинусному расстоянию. В Neon доступно из коробки, нужно только
-- включить: CREATE EXTENSION.
--
-- Размерность 1024: модель baai/bge-m3 возвращает именно такие векторы.
-- Размерность входит в тип колонки, поэтому смена модели требует
-- ALTER TABLE ... TYPE vector(другая_размерность) и переиндексации.
CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE price_items
  ADD COLUMN IF NOT EXISTS embedding vector(1024),
  ADD COLUMN IF NOT EXISTS embedded_at timestamptz;

-- Индекс по косинусному расстоянию.
--
-- HNSW (Hierarchical Navigable Small World) — графовый индекс: ищет
-- приближённо, но за миллисекунды. Для 215 позиций точный перебор был бы
-- тоже быстрым, но индекс ставим сразу: прайс вырастет, а переделывать
-- потом больнее.
--
-- vector_cosine_ops — оператор косинусного расстояния. Модель возвращает
-- нормализованные векторы, так что косинус равен скалярному произведению,
-- но индекс настраиваем на косинус: это не зависит от нормализации.
CREATE INDEX IF NOT EXISTS price_items_embedding_idx
  ON price_items USING hnsw (embedding vector_cosine_ops);
