"use client";

import { FormEvent, useState } from "react";

import type { RouteSearchResult } from "@/types/route";

export default function HomePage() {
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RouteSearchResult | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ origin, destination }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error ?? "検索に失敗しました");
      }

      setResult(data as RouteSearchResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "検索に失敗しました");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-full bg-slate-100 text-slate-900">
      <div className="mx-auto flex min-h-full max-w-3xl flex-col px-4 py-10">
        <header className="mb-8">
          <p className="text-sm font-medium text-blue-700">IC推定ツール</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight">
            乗り口・降り口ICを検索
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            住所・地域名・駅名・建物名など、ざっくりした入力でも検索できます（関東近郊対応）
          </p>
          <p className="mt-1 text-xs text-slate-400">
            場所検索: OpenStreetMap / 住所・駅: 国土地理院・HeartRails / ルート: OSRM
            / 結果は推定値です
          </p>
        </header>

        <form
          onSubmit={handleSubmit}
          className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
        >
          <div className="space-y-4">
            <label className="block">
              <span className="mb-1 block text-sm font-medium">出発地</span>
              <input
                type="text"
                value={origin}
                onChange={(e) => setOrigin(e.target.value)}
                placeholder="例: 新宿 / 東京タワー / 東京都千代田区丸の内"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-blue-500 focus:ring-2"
                required
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-sm font-medium">目的地</span>
              <input
                type="text"
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                placeholder="例: 横浜 / みなとみらい / ランドマークタワー"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-blue-500 focus:ring-2"
                required
              />
            </label>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="mt-6 w-full rounded-lg bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
          >
            {loading ? "検索中..." : "ルートを検索"}
          </button>
        </form>

        {error && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {result && (
          <section className="mt-6 space-y-4">
            {result.estimationNote && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                {result.estimationNote}
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-3">
              <SummaryCard label="総距離" value={`${result.distanceKm} km`} />
              <SummaryCard
                label="高速道路"
                value={`${result.highwayDistanceKm ?? "-"} km`}
              />
              <SummaryCard
                label="所要時間"
                value={`${result.durationMin} 分`}
              />
            </div>

            <IcResultCard
              title="推定乗り口IC"
              primary={result.entryIc}
              candidates={result.entryCandidates}
            />

            <IcResultCard
              title="推定降り口IC"
              primary={result.exitIc}
              candidates={result.exitCandidates}
            />

            <div className="rounded-xl border border-slate-200 bg-white p-4 text-xs text-slate-500">
              <p>出発: {result.origin.address}</p>
              <p className="mt-1">到着: {result.destination.address}</p>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
    </div>
  );
}

function IcResultCard({
  title,
  primary,
  candidates,
}: {
  title: string;
  primary: RouteSearchResult["entryIc"];
  candidates: RouteSearchResult["entryCandidates"];
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-sm font-medium text-slate-500">{title}</h2>
      <p className="mt-2 text-2xl font-bold text-blue-700">
        {primary.nameDisplay}
      </p>
      <p className="mt-1 text-xs text-slate-500">
        直線距離 約 {(primary.distanceM / 1000).toFixed(1)} km
      </p>

      {candidates.length > 1 && (
        <div className="mt-4">
          <p className="text-xs font-medium text-slate-500">候補</p>
          <ul className="mt-2 space-y-1">
            {candidates.slice(1).map((candidate) => (
              <li
                key={candidate.id}
                className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm"
              >
                <span>{candidate.nameDisplay}</span>
                <span className="text-xs text-slate-500">
                  約 {(candidate.distanceM / 1000).toFixed(1)} km
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
