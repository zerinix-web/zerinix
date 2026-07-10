export function getRegisterRouteState(user) {
  return user ? "redirect_dashboard" : "private_beta";
}
