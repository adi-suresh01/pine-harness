import { connectionFromDelegation } from "@pinesandbox/computer-web";
import { PineDesktop } from "@pinesandbox/computer-web/react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Delegation } from "./api";

interface Props {
  /** Mints a fresh delegation on the server; called before every connect and reconnect. */
  delegate: () => Promise<Delegation>;
  /** Changing this reconnects to a different desktop. */
  desktopKey: string;
  drive?: boolean;
}

export function LiveDesktop({ delegate, desktopKey, drive = false }: Props) {
  const [conn, setConn] = useState<{ url: string; tokenTransport: "subprotocol" }>();
  const [status, setStatus] = useState("Connecting to the desktop");
  // the first delegation already carries a token; spend it instead of minting a second one
  const firstToken = useRef<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    setConn(undefined);
    setStatus("Connecting to the desktop");
    delegate()
      .then((d) => {
        if (cancelled) return;
        firstToken.current = d.transports.desktop_token.token;
        const c = connectionFromDelegation(d);
        setConn({ url: c.url, tokenTransport: c.tokenTransport as "subprotocol" });
      })
      .catch((err: Error) => !cancelled && setStatus(err.message));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desktopKey]);

  const token = useCallback(async () => {
    const t = firstToken.current;
    firstToken.current = undefined;
    return t ?? (await delegate()).transports.desktop_token.token;
  }, [delegate]);

  if (!conn) return <div className="desktop desktop--empty">{status}</div>;
  return (
    <div className="desktop">
      <PineDesktop
        key={desktopKey}
        url={conn.url}
        token={token}
        tokenTransport={conn.tokenTransport}
        control={drive ? "drive" : "view"}
        clipboard={drive ? ["local-to-remote"] : []}
        toolbar="off"
        reconnectMaxAttempts={8}
        onConnected={() => setStatus("")}
        onReconnectExhausted={() => setStatus("The desktop stopped answering. Pick the tile again to reconnect.")}
        style={{ width: "100%", height: "100%" }}
      />
      {status && <div className="desktop__status">{status}</div>}
    </div>
  );
}
