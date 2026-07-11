"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Search } from "lucide-react";

const searchFilters = [
  { id: "users", label: "Users" },
  { id: "reports", label: "Reports" },
  { id: "conversations", label: "Conversations" },
  { id: "payments", label: "Payments" },
  { id: "logs", label: "Logs" },
];

type SearchGroup = {
  label: string;
  results: Array<{
    id: string;
    title: string;
    detail: string;
    href: string;
  }>;
};

export function AdminGlobalSearch() {
  const [query, setQuery] = useState("");
  const [activeFilters, setActiveFilters] = useState(searchFilters.map((filter) => filter.id));
  const [groups, setGroups] = useState<SearchGroup[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [activeIndex, setActiveIndex] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const flattenedResults = useMemo(
    () => groups.flatMap((group) => group.results.map((result) => ({ ...result, group: group.label }))),
    [groups]
  );

  useEffect(() => {
    const trimmed = query.trim();

    abortRef.current?.abort();

    if (trimmed.length < 2) {
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;

    const timeout = window.setTimeout(async () => {
      try {
        const params = new URLSearchParams({
          q: trimmed,
          filters: activeFilters.join(","),
        });
        const response = await fetch(`/api/admin/search?${params.toString()}`, {
          signal: controller.signal,
          headers: { Accept: "application/json" },
        });

        if (!response.ok) {
          throw new Error("Search failed");
        }

        const payload = (await response.json()) as { groups?: SearchGroup[] };
        setGroups(payload.groups || []);
        setStatus("ready");
        setActiveIndex(0);
      } catch {
        if (controller.signal.aborted) {
          return;
        }

        setStatus("error");
        setGroups([]);
      }
    }, 250);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [activeFilters, query]);

  function toggleFilter(filterId: string) {
    setActiveFilters((current) => {
      if (current.includes(filterId)) {
        const next = current.filter((item) => item !== filterId);

        return next.length ? next : current;
      }

      return [...current, filterId];
    });
  }

  function handleQueryChange(value: string) {
    setQuery(value);

    if (value.trim().length < 2) {
      setGroups([]);
      setStatus("idle");
      setActiveIndex(0);
    } else {
      setStatus("loading");
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!flattenedResults.length) {
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((value) => Math.min(flattenedResults.length - 1, value + 1));
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((value) => Math.max(0, value - 1));
    }

    if (event.key === "Enter") {
      const result = flattenedResults[activeIndex];

      if (result) {
        window.location.href = result.href;
      }
    }
  }

  return (
    <div className="relative w-full max-w-xl">
      <label className="relative block">
        <span className="sr-only">Search admin records</span>
        <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
        <input
          value={query}
          onChange={(event) => handleQueryChange(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search users, reports, conversations..."
          className="h-12 w-full rounded-2xl border border-white/10 bg-black/35 pl-11 pr-4 text-sm text-white outline-none transition placeholder:text-zinc-600 focus:border-teal-300/35 focus:ring-2 focus:ring-teal-300/10"
        />
      </label>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {searchFilters.map((filter) => {
          const active = activeFilters.includes(filter.id);

          return (
            <button
              key={filter.id}
              type="button"
              onClick={() => toggleFilter(filter.id)}
              className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] transition ${
                active
                  ? "border-teal-300/30 bg-teal-300/10 text-teal-100"
                  : "border-white/10 bg-black/25 text-zinc-500 hover:text-white"
              }`}
            >
              {filter.label}
            </button>
          );
        })}
      </div>

      {query.trim().length >= 2 ? (
        <div className="absolute left-0 right-0 top-14 z-30 overflow-hidden rounded-3xl border border-white/10 bg-zinc-950/95 p-3 shadow-2xl shadow-black/40 backdrop-blur-2xl">
          {status === "loading" ? (
            <p className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-sm text-zinc-500">
              Searching admin records...
            </p>
          ) : null}

          {status === "error" ? (
            <p className="rounded-2xl border border-red-300/20 bg-red-950/20 p-4 text-sm text-red-100">
              Search is temporarily unavailable.
            </p>
          ) : null}

          {status === "ready" && !groups.length ? (
            <p className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-sm text-zinc-500">
              No matching admin records.
            </p>
          ) : null}

          {groups.map((group) => (
            <div key={group.label} className="py-2">
              <p className="px-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
                {group.label}
              </p>
              <div className="mt-2 space-y-1">
                {group.results.map((result) => {
                  const resultIndex = flattenedResults.findIndex((item) => item.id === result.id);

                  return (
                    <Link
                      key={`${group.label}:${result.id}`}
                      href={result.href}
                      className={`block rounded-2xl border px-3 py-2 text-sm transition ${
                        resultIndex === activeIndex
                          ? "border-teal-300/30 bg-teal-300/10"
                          : "border-transparent hover:border-white/10 hover:bg-white/[0.04]"
                      }`}
                    >
                      <span className="block font-medium text-white">{result.title}</span>
                      <span className="mt-1 block text-xs text-zinc-500">{result.detail}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
