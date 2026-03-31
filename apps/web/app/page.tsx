"use client";

import Link from "next/link";
import { useState } from "react";

import { DEMO_ROOM_ID } from "@collabcode/shared";

export default function HomePage() {
  const [roomId, setRoomId] = useState(DEMO_ROOM_ID);

  return (
    <main className="flex min-h-screen items-center px-4 py-8 lg:px-6">
      <div className="mx-auto grid w-full max-w-6xl gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <section className="rounded-[32px] border border-border bg-panel/80 p-8 shadow-panel backdrop-blur">
          <h1 className="max-w-2xl text-4xl font-semibold leading-tight lg:text-6xl">
            CollabCode AI
          </h1>
          <p className="mt-5 max-w-2xl text-lg text-muted">
            Браузерный редактор для совместной работы с кодом в реальном времени,
            общим запуском Python и AI review-подсказками по изменениям.
          </p>

          <div className="mt-8 flex flex-col gap-4 sm:flex-row">
            <Link
              href={`/room/${DEMO_ROOM_ID}`}
              className="rounded-full bg-accent px-6 py-3 text-center font-semibold text-ink transition hover:bg-glow"
            >
              Открыть демо-комнату
            </Link>
            <div className="rounded-full border border-border px-6 py-3 text-center text-sm text-muted">
              Быстрый вход в комнату
            </div>
          </div>

          <div className="mt-10 grid gap-4 md:grid-cols-3">
            <div className="rounded-3xl border border-border/80 bg-ink/40 p-4">
              <div className="text-sm font-semibold">Совместный редактор</div>
              <p className="mt-2 text-sm text-muted">
                Monaco и Yjs синхронизируют один документ между несколькими участниками.
              </p>
            </div>
            <div className="rounded-3xl border border-border/80 bg-ink/40 p-4">
              <div className="text-sm font-semibold">AI Review</div>
              <p className="mt-2 text-sm text-muted">
                Подсказки появляются по diff и помогают быстро показать ценность продукта.
              </p>
            </div>
            <div className="rounded-3xl border border-border/80 bg-ink/40 p-4">
              <div className="text-sm font-semibold">Общий запуск</div>
              <p className="mt-2 text-sm text-muted">
                Выполнение Python идет в Docker sandbox, а логи видны всем в комнате.
              </p>
            </div>
          </div>
        </section>

        <section className="rounded-[32px] border border-border bg-panel/80 p-8 shadow-panel backdrop-blur">
          <h2 className="text-xl font-semibold">Подключиться к комнате</h2>
          <p className="mt-2 text-sm text-muted">
            Используйте демо-комнату или введите свой `roomId`.
          </p>

          <label className="mt-8 block text-sm text-muted" htmlFor="roomId">
            Room ID
          </label>
          <input
            id="roomId"
            value={roomId}
            onChange={(event) => setRoomId(event.target.value)}
            className="mt-2 w-full rounded-2xl border border-border bg-ink/40 px-4 py-3 text-base text-slate-100 outline-none transition focus:border-accent"
            placeholder="demo-room"
          />

          <Link
            href={`/room/${encodeURIComponent(roomId || DEMO_ROOM_ID)}`}
            className="mt-4 block rounded-2xl border border-accent/40 bg-accent/10 px-4 py-3 text-center font-medium text-accent transition hover:border-accent hover:bg-accent/20"
          >
            Войти в комнату
          </Link>

          <div className="mt-8 rounded-3xl border border-border/80 bg-ink/40 p-5">
            <div className="text-sm font-semibold">Сценарий демо</div>
            <ul className="mt-3 space-y-2 text-sm text-muted">
              <li>1. Откройте одну и ту же комнату в двух вкладках.</li>
              <li>2. Покажите совместное редактирование и удаленные курсоры.</li>
              <li>3. Запустите Python и продемонстрируйте общий терминал.</li>
              <li>4. Добавьте рискованный код и покажите AI review.</li>
            </ul>
          </div>
        </section>
      </div>
    </main>
  );
}
