// "Watch in 60s": the one-minute explainer (a YouTube Short) in a pop-up.
// Nothing from YouTube loads until the button is pressed; the player is the
// no-cookie one. The Short is vertical, so it sits in a tall window rather
// than in the page, where it would leave wide bars on a desktop.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const VIDEO = "L_wH5B0FZvY";

export function WatchButton({ className = "" }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const close = () => { setOpen(false); btn.current?.focus(); };
  return (
    <>
      <button ref={btn} className={`watch-btn ${className}`} onClick={() => setOpen(true)} aria-haspopup="dialog">
        <span className="watch-play" aria-hidden="true">▶</span> Watch in 60s
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
          <span>STOOK STREET IN 60s</span>
          <button ref={shut} className="watch-x" onClick={onClose} aria-label="Close the video">✕</button>
        </div>
        <div className="watch-frame">
          <iframe src={`https://www.youtube-nocookie.com/embed/${VIDEO}?autoplay=1&rel=0&playsinline=1&modestbranding=1`}
            title="Stook Street: call where your coin's Stonk closes" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen />
        </div>
        <a className="watch-yt" href={`https://www.youtube.com/shorts/${VIDEO}`} target="_blank" rel="noreferrer">Open on YouTube ↗</a>
      </div>
    </div>,
    document.body,
  );
}
