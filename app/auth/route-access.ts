export const AUTH_ONLY_ROUTES = ["/login", "/register"] as const;
export const AUTHENTICATED_REDIRECT_PATH = "/dashboard" as const;

export type AuthOnlyRoute = (typeof AUTH_ONLY_ROUTES)[number];
export type AuthRouteState = "redirect_dashboard" | "show_auth";
export type AuthRouteUser = unknown;

export function isAuthOnlyRoute(pathname: string): pathname is AuthOnlyRoute {
  return (AUTH_ONLY_ROUTES as readonly string[]).includes(pathname);
}

export function getAuthRouteState(user: AuthRouteUser): AuthRouteState {
  return user ? "redirect_dashboard" : "show_auth";
}

export function getAuthRouteRedirectPath(
  pathname: string,
  user: AuthRouteUser
): typeof AUTHENTICATED_REDIRECT_PATH | null {
  if (!isAuthOnlyRoute(pathname)) {
    return null;
  }

  return getAuthRouteState(user) === "redirect_dashboard"
    ? AUTHENTICATED_REDIRECT_PATH
    : null;
}
