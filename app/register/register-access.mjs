import { getAuthRouteState } from "../auth/route-access.ts";

export function getRegisterRouteState(user) {
  return getAuthRouteState(user) === "redirect_dashboard"
    ? "redirect_dashboard"
    : "private_beta";
}
