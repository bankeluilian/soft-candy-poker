const channelLabel = "soft-candy-poker-lan-v2";
const signalLimit = 30000;

type SignalType = "offer" | "answer";
type PeerEvents = {
  open: () => void;
  disconnected: () => void;
  message: (data: unknown) => void;
};

function readSignal(code: string, type: SignalType): RTCSessionDescriptionInit {
  try {
    const input = code.replace(/\s/g, "");
    if (!input || input.length > signalLimit) throw new Error();
    const data = JSON.parse(atob(input));
    if (data.game !== channelLabel || data.type !== type || typeof data.sdp !== "string" || !data.sdp.startsWith("v=0")) throw new Error();
    return { type, sdp: data.sdp };
  } catch {
    throw new Error("配对信息格式不正确，请双方刷新到同一版本，再复制对应步骤的完整信息。");
  }
}

async function gatherSignal(peer: RTCPeerConnection, description: RTCSessionDescriptionInit) {
  await peer.setLocalDescription(description);
  if (peer.iceGatheringState !== "complete") {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        peer.removeEventListener("icegatheringstatechange", onChange);
        reject(new Error("生成配对信息超时，请确认已连接 Wi-Fi 后重试。"));
      }, 8000);
      const onChange = () => {
        if (peer.iceGatheringState !== "complete") return;
        peer.removeEventListener("icegatheringstatechange", onChange);
        clearTimeout(timeout);
        resolve();
      };
      peer.addEventListener("icegatheringstatechange", onChange);
      onChange();
    });
  }
  const local = peer.localDescription;
  if (!local?.sdp.includes("a=candidate:")) throw new Error("浏览器没有找到可用的局域网地址，请确认已连接 Wi-Fi。");
  return btoa(JSON.stringify({ game: channelLabel, type: local.type, sdp: local.sdp }));
}

export function createLanPeer(role: "host" | "guest", events: PeerEvents) {
  if (typeof RTCPeerConnection === "undefined") throw new Error("当前浏览器无法建立局域网连接，请用最新版 Chrome、Edge 或 Safari 打开。");

  const peer = new RTCPeerConnection({ iceServers: [] });
  let channel: RTCDataChannel | null = null;
  let closed = false;
  let connectTimer: ReturnType<typeof setTimeout> | undefined;
  function close() {
    if (closed) return;
    closed = true;
    clearTimeout(connectTimer);
    channel?.close();
    peer.close();
  }

  function disconnect() {
    if (closed) return;
    close();
    events.disconnected();
  }

  function bindChannel(next: RTCDataChannel) {
    if (closed || channel || next.label !== channelLabel) {
      next.close();
      return;
    }
    channel = next;
    next.addEventListener("open", () => {
      clearTimeout(connectTimer);
      if (!closed) events.open();
    });
    next.addEventListener("close", disconnect);
    next.addEventListener("error", disconnect);
    next.addEventListener("message", (event) => {
      if (closed || typeof event.data !== "string" || event.data.length > 8192) return;
      let data: unknown;
      try { data = JSON.parse(event.data); } catch { return; }
      events.message(data);
    });
  }

  if (role === "host") bindChannel(peer.createDataChannel(channelLabel));
  else peer.addEventListener("datachannel", ({ channel }) => bindChannel(channel));

  peer.addEventListener("connectionstatechange", () => {
    if (peer.connectionState === "failed" || peer.connectionState === "closed") disconnect();
  });

  return {
    async invite() {
      return gatherSignal(peer, await peer.createOffer());
    },
    async answer(invite: string) {
      await peer.setRemoteDescription(readSignal(invite, "offer"));
      return gatherSignal(peer, await peer.createAnswer());
    },
    async accept(answer: string) {
      await peer.setRemoteDescription(readSignal(answer, "answer"));
      if (!closed && channel?.readyState !== "open") connectTimer = setTimeout(disconnect, 18000);
    },
    send(data: unknown) {
      if (closed || channel?.readyState !== "open") return false;
      try {
        channel.send(JSON.stringify(data));
        return true;
      } catch {
        disconnect();
        return false;
      }
    },
    close,
  };
}
