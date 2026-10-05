"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { LogIn } from "lucide-react";
import { Button, Input, Label } from "@/components/ui/primitives";

interface SignInFormProps {
  demoHint: { email: string; password: string } | null;
}

export function SignInForm({ demoHint }: SignInFormProps) {
  const router = useRouter();
  const [email, setEmail] = useState(demoHint?.email ?? "");
  const [password, setPassword] = useState(demoHint?.password ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string; user?: { name: string } };
      if (!response.ok) {
        setError(payload.error ?? "Sign-in failed. Please try again.");
        return;
      }
      toast.success(`Welcome back${payload.user?.name ? `, ${payload.user.name.split(" ")[0]}` : ""}`);
      router.replace("/dashboard");
      router.refresh();
    } catch {
      setError("The server could not be reached. Check that the app is running.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="email">Work email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@agency.com"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="••••••••"
        />
      </div>

      {error ? (
        <p role="alert" className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-xs text-danger-soft-foreground">
          {error}
        </p>
      ) : null}

      <Button type="submit" loading={pending} className="w-full" size="lg">
        {pending ? "Signing in" : "Sign in"}
        {!pending ? <LogIn className="size-4" /> : null}
      </Button>

      {demoHint ? (
        <p className="rounded-md border border-dashed border-border bg-surface-muted px-3 py-2 text-2xs text-muted-foreground">
          Demo workspace seeded: <span className="font-medium text-foreground">{demoHint.email}</span> with password{" "}
          <span className="font-mono">{demoHint.password}</span>. Change it, or set <code>SEED_PASSWORD</code>, before
          exposing this instance.
        </p>
      ) : null}
    </form>
  );
}
