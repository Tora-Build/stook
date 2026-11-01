// "60 s video": the one-minute explainer, served by the site itself
// (public/video, made in infra/promo) in a pop-up. Nothing loads until the
// button is pressed. The cut is vertical, so it sits in a tall window rather
// than in the page, where it would leave wide bars on a desktop.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const SRC = "/video/stook-60s.mp4", POSTER = "/video/stook-60s.jpg";

// `bare` drops the old look so a page can style it fully (e.g. "btn btn-ghost").
export function WatchButton({ className = "", label = "Watch in 60s", bare = false }: { className?: string; label?: string; bare?: boolean }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const close = () => { setOpen(false); btn.current?.focus(); };
  return (
    <>
      <button ref={btn} className={bare ? className : `watch-btn ${className}`} onClick={() => setOpen(true)} aria-haspopup="dialog">
        <span className="watch-play" aria-hidden="true">▶</span> {label}
      </button>
      {open && <WatchModal onClose={close} />}
    </>
  );
}

function WatchModal({ onClose }: { onClose: () => void }) {
  const shut = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    shut.current?.focus();
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", key);
    const overflow = document.body.style.overflow; document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", key); document.body.style.overflow = overflow; };
  }, [onClose]);
  return createPortal(
    <div className="watch-back" onClick={onClose}>
      <div className="watch-box" role="dialog" aria-modal="true" aria-label="Stook Street in 60 seconds" onClick={(e) => e.stopPropagation()}>
        <div className="watch-head">
          <span className="pix">STOOK STREET IN 60s</span>
          <button ref={shut} className="watch-x" onClick={onClose} aria-label="Close the video">✕</button>
        </div>
        <div className="watch-frame">
          <video src={SRC} poster={POSTER} controls autoPlay playsInline preload="metadata" title="Stook Street: call where your coin's anchor closes" />
        </div>
        <a className="watch-yt" href={SRC} download="stook-street-60s.mp4">Save the video ↓</a>
      </div>
    </div>,
    document.body,
  );
}
