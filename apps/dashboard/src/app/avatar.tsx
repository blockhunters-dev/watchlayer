"use client";
import { useEffect, useRef, useState } from "react";

/** Logo from the validator's registered identity (already http(s)-only from the API); initials when missing or broken. */
export function Avatar({ logo, name, size = 32 }: { logo: string | null; name: string; size?: number }) {
  const [broken, setBroken] = useState(false);
  const img = useRef<HTMLImageElement>(null);
  // An image can fail before hydration attaches onError; catch that case on mount.
  useEffect(() => { const el = img.current; if (el && el.complete && el.naturalWidth === 0) setBroken(true); }, []);
  const style = { width: size, height: size, fontSize: Math.round(size * 0.36) };
  if (!logo || broken) return <span className="avatar fallback" aria-hidden="true" style={style}>{name.replace(/^0x/, "").slice(0, 2).toUpperCase()}</span>;
  // eslint-disable-next-line @next/next/no-img-element
  return <img ref={img} className="avatar" src={logo} alt="" width={size} height={size} loading={size > 40 ? "eager" : "lazy"} referrerPolicy="no-referrer" style={style} onError={() => setBroken(true)} />;
}
