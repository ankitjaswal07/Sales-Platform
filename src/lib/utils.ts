import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merges Tailwind classes the way shadcn-style components expect. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** 12800 → "12.8k" — used in stat tiles where space is tight. */
export function compactNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}m`;
  if (Math.abs(value) >= 10_000) return `${Math.round(value / 1000)}k`;
  if (Math.abs(value) >= 1_000) return `${(value / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(Math.round(value));
}

export function formatMoney(value: number | null | undefined, currency = "GBP"): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
      notation: Math.abs(value) >= 100_000 ? "compact" : "standard",
    }).format(value);
  } catch {
    return `${currency} ${Math.round(value).toLocaleString("en-GB")}`;
  }
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const seconds = Math.round((Date.now() - then) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.round(months / 12)}y ago`;
}
