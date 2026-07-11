"use client";

import RouteErrorState from "@/components/RouteErrorState";

export default function PlanError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <RouteErrorState
      title="AI workspace could not be loaded."
      description="The planner view hit a runtime error before it could start. Try again to reload your workspace."
      reset={reset}
    />
  );
}
