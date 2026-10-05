"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PRIMARY_NAV, navItemFor } from "./nav-items";
import { cn } from "@/lib/utils";

export function AppNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const active = navItemFor(pathname);

  return (
    <nav aria-label="Primary" className="flex flex-col gap-5 px-3 py-4">
      {PRIMARY_NAV.map((group) => (
        <div key={group.section} className="space-y-1">
          <p className="px-3 text-2xs font-medium uppercase tracking-wider text-subtle-foreground">{group.section}</p>
          {group.items.map((item) => {
            const isActive = active?.href === item.href;
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "group flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                  isActive
                    ? "bg-sidebar-accent font-medium text-foreground"
                    : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
                )}
              >
                <Icon className={cn("size-4 shrink-0", isActive ? "text-primary" : "text-subtle-foreground group-hover:text-muted-foreground")} />
                <span className="truncate">{item.label}</span>
                {item.status === "in_build" ? (
                  <span
                    title="This screen is in build — open it to see what already works behind it"
                    className="ml-auto size-1.5 shrink-0 rounded-full bg-warning"
                  />
                ) : null}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
