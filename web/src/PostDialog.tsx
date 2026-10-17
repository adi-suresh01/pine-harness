import { useCallback, useEffect, useRef, useState } from "react";
import { posterDesktop, posterOpen, posterRelease } from "./api";
import { LiveDesktop } from "./LiveDesktop";
import { Prose } from "./Prose";

interface Props {
  url: string;
  draft: string;
  onClose: () => void;
}

/**
 * Opens the issue on the Computer signed in to my GitHub and gives me the controls. The
 * comment only goes out when I paste it and click Comment myself.
 */
export function PostDialog({ url, draft, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!ref.current?.open) ref.current?.showModal();
    posterOpen(url)
      .then(() => !cancelled && setReady(true))
      .catch((err: Error) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [url]);

  const delegate = useCallback(() => posterDesktop(), []);

  // close at once; handing control back happens in the background
  const finish = (posted: boolean) => {
    ref.current?.close();
    onClose();
    void posterRelease(posted ? url : undefined).catch(() => undefined);
  };

  return (
    <dialog ref={ref} className="post" onCancel={(e) => (e.preventDefault(), finish(false))}>
      <div className="post__desktop">
        {error ? <div className="desktop desktop--empty">{error}</div> : ready ? <LiveDesktop delegate={delegate} desktopKey={`poster:${url}`} drive /> : <div className="desktop desktop--empty">Opening the issue on my signed-in Computer</div>}
      </div>
      {!draft ? (
        <aside className="post__side">
          <h2>Sign in to GitHub</h2>
          <p>
            This Computer is the only one that posts. Sign in here once; Pine keeps the session across restarts, and the
            triage agents never run on it.
          </p>
          <div className="post__actions">
            <button className="btn" onClick={() => finish(false)}>
              Done
            </button>
          </div>
        </aside>
      ) : (
      <aside className="post__side">
        <h2>Post this comment</h2>
        <p className="post__how">Copy it, paste it into the comment box on the desktop, read it once more, then click Comment.</p>
        <Prose text={draft} />
        <div className="post__actions">
          <button
            className="btn"
            onClick={async () => {
              await navigator.clipboard.writeText(draft);
              setCopied(true);
            }}
          >
            {copied ? "Copied" : "Copy comment"}
          </button>
          <button className="btn btn--quiet" onClick={() => finish(true)}>
            I posted it
          </button>
          <button className="link" onClick={() => finish(false)}>
            Close without posting
          </button>
        </div>
      </aside>
      )}
    </dialog>
  );
}
