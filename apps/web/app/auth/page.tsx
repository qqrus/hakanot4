"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { motion } from "framer-motion";

import { login, register } from "../../lib/platform-api";

export default function AuthPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const submit = async (): Promise<void> => {
    setErrorMessage(null);
    setIsSubmitting(true);
    try {
      if (mode === "register") {
        await register({ name, email, password });
      } else {
        await login({ email, password });
      }
      router.push("/cabinet");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Ошибка авторизации.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="relative min-h-screen overflow-hidden px-4 py-8 lg:px-8">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-24 top-6 h-72 w-72 rounded-full bg-accent/20 blur-[120px]" />
        <div className="absolute -right-16 top-24 h-64 w-64 rounded-full bg-primary/20 blur-[140px]" />
      </div>
      <div className="relative z-10 mx-auto flex max-w-md flex-col gap-5 rounded-[32px] border border-white/80 bg-white/70 p-6 shadow-panel backdrop-blur-2xl">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">CollabCode</p>
          <h1 className="mt-2 text-3xl font-black text-ink">
            {mode === "register" ? "Создать аккаунт" : "Войти в кабинет"}
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            Управляйте своими комнатами, целями и запуском контейнеров.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2 rounded-2xl border border-slate-200 bg-white p-1">
          <button
            type="button"
            onClick={() => setMode("login")}
            className={`rounded-xl px-3 py-2 text-sm font-bold ${mode === "login" ? "bg-ink text-white" : "text-slate-500"}`}
          >
            Вход
          </button>
          <button
            type="button"
            onClick={() => setMode("register")}
            className={`rounded-xl px-3 py-2 text-sm font-bold ${mode === "register" ? "bg-ink text-white" : "text-slate-500"}`}
          >
            Регистрация
          </button>
        </div>

        <div className="space-y-3">
          {mode === "register" && (
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Ваше имя"
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 outline-none focus:border-accent"
            />
          )}
          <input
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="email@example.com"
            className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 outline-none focus:border-accent"
          />
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Пароль (минимум 8 символов)"
            className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 outline-none focus:border-accent"
          />
        </div>

        {errorMessage && (
          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="rounded-xl border border-primary/20 bg-primary/10 px-3 py-2 text-sm font-semibold text-primary">
            {errorMessage}
          </motion.p>
        )}

        <button
          type="button"
          onClick={() => void submit()}
          disabled={isSubmitting}
          className="rounded-2xl bg-gradient-to-r from-accent to-primary px-4 py-3 text-sm font-black uppercase tracking-wide text-white shadow-neon-pink transition hover:brightness-105 disabled:opacity-50"
        >
          {isSubmitting ? "Обработка..." : mode === "register" ? "Зарегистрироваться" : "Войти"}
        </button>

        <div className="text-xs text-slate-500">
          <Link href="/" className="font-bold text-accent hover:underline">
            Вернуться на главную
          </Link>
        </div>
      </div>
    </main>
  );
}
