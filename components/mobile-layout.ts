// Shared mobile layout constants.
//
// THIS MODULE MUST NOT BE A CLIENT MODULE, and that is a correctness
// requirement, not a preference. These constants used to live in
// components/MobileNavigation.tsx, which is "use client". A server component
// importing a non-component export from a client module does not receive the
// value -- Next.js hands it a client-reference proxy that throws "Attempted to
// call X() from the server" when invoked. Interpolating that proxy into a
// template literal never throws; it silently serialises the proxy's source
// text into the class attribute. Safari Web Inspector on a physical iPhone
// caught it on the production dashboard, where Home's scroll container read:
//
//   class="px-4 pt-6 function(){throw Error(\"Attempted to call
//          MOBILE_SCROLLER_TAIL() from "
//
// So the utility never existed, padding-bottom computed to 0px, and Home's
// scroll range collapsed to 13px -- its last card unreachable without
// rubber-banding. The same stub zeroed the status-bar inset on every server
// component that used these (Home, Account, Workspace detail), while the
// client ones (Reports, Projects, Ask) were fine.
//
// Plain strings belong in a plain module. Import them from HERE, never from
// the navigation component.

// Safe-area ownership for every mobile screen that sits under the fixed
// MobileBottomNavigation. Exported from this file because this is where the
// navigation itself is defined, so the reserved height can never drift from
// the thing it reserves for.
//
// Rules, applied exactly once each:
//   - MOBILE_SAFE_AREA_TOP goes on a screen's topmost element. These routes
//     render no shared header (DashboardSidebar only renders MobileHeader
//     when showMobileNavigation is set, which these pages do not do), so the
//     screen root is the top boundary and owns the status-bar inset.
//   - MOBILE_NAV_CLEARANCE goes on the same screen root. 4.75rem is this
//     navigation's own composition below (pt-2 + p-1.5 twice + min-h-14),
//     and the env() term is the home-indicator inset the navigation itself
//     adds -- so the screen reserves the real height, never a guess.
//   - The navigation's own pb-[max(0.65rem,env(safe-area-inset-bottom))]
//     below is the ONLY place the bottom inset is consumed for the bar.
//
// On web and desktop every env() term resolves to 0, so spacing collapses
// back to the plain rem values.
// The arithmetic lives HERE, in the declaration, and --zx-status-bar supplies
// only a terminal length. The reverse -- a --zx-safe-area-top variable holding
// calc(1.25rem + var(--zx-status-bar)), consumed as pt-[var(--zx-safe-area-top)]
// -- is what shipped before, and it computed to 0px on a physical iPhone while
// the same expression written literally computed to 82px (see app/globals.css).
// The inset itself is still defined once, centrally; only the addition moved.
export const MOBILE_SAFE_AREA_TOP = "pt-[calc(1.25rem+var(--zx-status-bar))]";
// Mirrors the navigation's real height exactly: 4.75rem of rows/padding plus
// --zx-home-indicator, which is the very same max(0.65rem, env(...)) the bar
// applies to itself below. One definition, so the reservation cannot drift
// from the bar it reserves for, on any device.
export const MOBILE_NAV_CLEARANCE =
  "pb-[calc(4.75rem+var(--zx-home-indicator))]";
// The tail of a scroll container whose last card should come to rest CLEAR of
// the bar rather than flush against its top edge: the same reservation plus a
// 1.5rem reading gap. Two rules govern it, both learned from device
// measurements:
//   - It goes on an in-flow CHILD of the scroller, never on the scroll
//     container itself: WebKit leaves a scroll container's own padding-bottom
//     out of its scrollable overflow, so there it adds no reachable range.
//   - The calc() lives in the class; --zx-home-indicator supplies only a
//     terminal length. A calc()-valued custom property consumed through var()
//     computes to 0 on iOS WebKit (see app/globals.css).
// Written out in full because Tailwind only sees literal class strings; a
// composed template literal would never be generated. Tests pin it to
// MOBILE_NAV_CLEARANCE so the two can never drift apart.
export const MOBILE_SCROLLER_TAIL =
  "pb-[calc(1.5rem+4.75rem+var(--zx-home-indicator))]";
