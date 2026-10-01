import Image from "next/image";

// The single canonical ZERINIX brand mark. Every surface renders this one
// asset, so the logo only ever has to be replaced in one place.
//
// The artwork is square and sits on an opaque black field. That is why call
// sites frame it with a square box and why none of them paint a background
// behind it -- the image would cover it anyway.
const LOGO_SRC = "/zerinix-logo.png";

// The mark never displays larger than ~44px, so the optimized variants are
// generated from this size rather than the artwork's full 1254px. Still crisp
// on 2x and 3x displays, but a fraction of the bytes.
const INTRINSIC_SIZE = 128;

type ZerinixLogoProps = {
  /**
   * Sizing and corner rounding for the frame. Each surface passes the
   * dimensions its previous mark used, so swapping the logo in changes no
   * layout.
   */
  className?: string;
  /**
   * Empty by default: every current call site renders the mark next to a
   * visible "ZERINIX" wordmark or inside an already-labelled link, so
   * describing it again would only repeat the brand name. Pass alt text on
   * any surface where the mark stands alone.
   */
  alt?: string;
};

export default function ZerinixLogo({
  className = "",
  alt = "",
}: ZerinixLogoProps) {
  return (
    <span className={`block shrink-0 overflow-hidden ${className}`}>
      <Image
        src={LOGO_SRC}
        alt={alt}
        width={INTRINSIC_SIZE}
        height={INTRINSIC_SIZE}
        // Site chrome: the mark is in the header, nav or sidebar, so it is in
        // view from the start and should not wait on the lazy-load observer.
        // (Next 16 deprecates `priority` in favour of `preload`, which is
        // heavier than this needs -- `eager` is the documented alternative.)
        loading="eager"
        // `object-contain`: square art in a square frame makes this a no-op
        // normally; it is here so the mark can never be stretched if a flex
        // parent squeezes it.
        //
        // `mix-blend-screen`: the artwork is gold on an OPAQUE black field, so
        // without this it paints a visible black tile on every surface that is
        // not pure black -- the auth screens' teal wash, the dashboard and
        // admin brand cards (bg-white/[0.045]), the Ask sidebar (bg-zinc-950)
        // and the translucent mobile header. Screen blending maps black to the
        // backdrop and leaves the gold untouched, so the mark sits on each
        // surface with no box, and the asset itself stays exactly as supplied.
        // On a pure-black backdrop screen is the identity function, so the
        // landing page, legal pages and loading skeletons are unaffected.
        className="h-full w-full object-contain mix-blend-screen"
      />
    </span>
  );
}
