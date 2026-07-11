"use client";

import RouteErrorState from "@/components/RouteErrorState";

export default function AdminError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <RouteErrorState
      title="Admin panel could not be loaded."
      description="The admin control plane hit a runtime error. Try again after checking your access and system configuration."
      reset={reset}
    />
  );
}
