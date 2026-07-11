"use client";

import RouteErrorState from "@/components/RouteErrorState";

export default function ChatError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <RouteErrorState
      title="AI Chat could not be loaded."
      description="The conversation view could not initialize. Try again, or return to the dashboard."
      reset={reset}
    />
  );
}
