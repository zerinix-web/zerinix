"use client";

import RouteErrorState from "@/components/RouteErrorState";

export default function DashboardError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <RouteErrorState
      title="Dashboard could not be loaded."
      description="Your workspace data is safe. Try loading the dashboard again, or return to the main dashboard."
      reset={reset}
    />
  );
}
