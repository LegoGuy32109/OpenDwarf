import { useState } from "preact/hooks";
import { Button } from "../components/Button.tsx";
import {
  compressRemotePeers,
  decompressRemotePeers,
  RemotePeer,
  WebrtcManager,
} from "../domain/webrtc.ts";

const webrtc = new WebrtcManager();

export default function MultiplayerSidebar() {
  const [open, setOpen] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [configText, setConfigText] = useState(() =>
    JSON.stringify(webrtc.peerConnectionConfig, null, 2)
  );
  const [configError, setConfigError] = useState<string | null>(null);
  const [relayOnly, setRelayOnly] = useState(
    () => webrtc.peerConnectionConfig.iceTransportPolicy === "relay",
  );

  const handleHost = async () => {
    const result = await webrtc.makeOfferingPeers(2);
    if (result.ok) {
      console.log("offers made");
      return;
    }
    console.error(result.errors);
  };

  const copyOfferPayload = async () => {
    const offerResult = webrtc.getOfferPayload();
    if (!offerResult.ok) {
      console.error(offerResult.errors);
      return;
    }
    try {
      const compressed = compressRemotePeers(
        offerResult.payload as RemotePeer[],
      );
      await navigator.clipboard.writeText(compressed);
      console.log("Offer payload copied to clipboard");
    } catch (e) {
      console.error("Failed to copy offer payload", e);
    }
  };

  const readClipboardPayload = async (): Promise<
    Array<RemotePeer> | null
  > => {
    try {
      const text = await navigator.clipboard.readText();
      const parsed = decompressRemotePeers(text);
      if (!Array.isArray(parsed)) {
        console.error("Clipboard payload must be an array");
        return null;
      }
      return parsed;
    } catch (e) {
      console.error("Failed to read clipboard payload", e);
      return null;
    }
  };

  const handleGuest = async () => {
    const payload = await readClipboardPayload();
    if (!payload) return;
    const result = await webrtc.makeGuestAnswers(payload);
    if (result.ok) {
      console.log("answers made");
      return;
    }
    console.error(result.errors);
  };

  const copyAnswerPayload = async () => {
    const answerResult = webrtc.getAnswerPayload();
    if (!answerResult.ok) {
      console.error(answerResult.errors);
      return;
    }
    try {
      const compressed = compressRemotePeers(
        answerResult.payload as RemotePeer[],
      );
      await navigator.clipboard.writeText(compressed);
      console.log("Answer payload copied to clipboard");
    } catch (e) {
      console.error("Failed to copy answer payload", e);
    }
  };

  const handleAnswerPayload = async () => {
    const payload = await readClipboardPayload();
    if (!payload) return;
    const result = webrtc.recieveAnswerPayload(payload);
    if (!result.ok) {
      console.error(result.errors);
      return;
    }

    console.log("answers recieved");
  };

  const handleSaveConfig = () => {
    const normalizeAndParse = (input: string) => {
      let text = input.trim();
      // Strip common zero-width / non-breaking spaces that can break JSON.parse
      text = text.replace(/[\u00A0\u200B\u200C\u200D\uFEFF]/g, "");
      if (!text.startsWith("{")) {
        text = `{${text}}`;
      }
      // Quote any bare keys so "iceServers: [...]" becomes valid JSON
      text = text.replace(
        /([{,\s])(\w+)\s*:/g,
        (_m, prefix, key) => `${prefix}"${key}":`,
      );
      text = text.replaceAll("\n", "");
      return JSON.parse(text);
    };

    try {
      const parsed = normalizeAndParse(configText) as RTCConfiguration;
      if (relayOnly) {
        parsed.iceTransportPolicy = "relay";
      } else if (parsed.iceTransportPolicy) {
        delete parsed.iceTransportPolicy;
      }
      console.log(parsed);
      webrtc.peerConnectionConfig = parsed;
      setConfigError(null);
      setConfigOpen(false);
      console.log("Updated WebRTC configuration");
    } catch (e) {
      setConfigError("Invalid JSON: " + (e instanceof Error ? e.message : e));
    }
  };

  return (
    <>
      <div class="flex items-center gap-2">
        <Button onClick={() => setOpen(true)}>Multiplayer</Button>
      </div>

      <div
        class={`fixed top-0 right-0 h-full w-full flex flex-row-reverse transform transition-transform duration-300 ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <aside
          class={`w-80 bg-[#1F1F22] text-white shadow-2xl border-l border-gray-700 `}
        >
          <div class="flex items-center justify-between p-4 border-b border-gray-700">
            <h2 class="text-lg font-semibold">Multiplayer</h2>
            <div class="flex items-center gap-2">
              <button
                type="button"
                aria-label="Configure WebRTC"
                onClick={() => setConfigOpen(true)}
                class="p-2 rounded hover:bg-gray-700 transition-colors"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  class="w-5 h-5"
                >
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 8 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.27.63.88 1.09 1.51 1.09H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
              </button>
              <button
                type="button"
                aria-label="Close multiplayer sidebar"
                onClick={() => setOpen(false)}
                class="p-2 rounded hover:bg-gray-700 transition-colors"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  class="w-5 h-5"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          </div>
          <div class="p-4 flex flex-col gap-3 text-sm text-gray-800">
            <p class="text-gray-300">Create a Room</p>
            <Button style="width: 100%;" onClick={handleHost}>
              Generate Connections
            </Button>
            <Button style="width: 100%;" onClick={copyOfferPayload}>
              Copy Offer Payload
            </Button>
            <Button style="width: 100%;" onClick={handleAnswerPayload}>
              Accept Answer Payload (from clipboard)
            </Button>
            <div class="width: 100% h-0.5 bg-gray-500 rounded-full" />
            <p class="text-gray-300">Join a Room</p>
            <Button style="width: 100%;" onClick={handleGuest}>
              Generate Answer Connections (from clipboard)
            </Button>
            <Button style="width: 100%;" onClick={copyAnswerPayload}>
              Copy Answer Payload
            </Button>
          </div>
        </aside>

        {open && (
          <div
            class="grow inset-0"
            onClick={() => setOpen(false)}
          />
        )}
      </div>

      {configOpen && (
        <div class="fixed inset-0 z-50 flex items-center justify-center">
          <div
            class="absolute inset-0 bg-black/60"
            onClick={() => setConfigOpen(false)}
          />
          <div class="relative w-[28rem] max-w-full rounded shadow-2xl border border-gray-700 bg-[#1F1F22] text-white p-4 z-10">
            <div class="flex items-center justify-between mb-3">
              <h3 class="text-lg font-semibold">WebRTC Configuration</h3>
              <button
                type="button"
                aria-label="Close configuration"
                onClick={() => setConfigOpen(false)}
                class="p-2 rounded hover:bg-gray-700 transition-colors"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  class="w-4 h-4"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <p class="text-sm text-gray-300 mb-2">
              Paste a JSON RTCConfiguration object to use for new connections.
              (Static TURN Credentials)
            </p>
            <label class="flex items-center gap-2 text-sm text-gray-200 mb-2">
              <input
                type="checkbox"
                checked={relayOnly}
                onChange={(e) => setRelayOnly(e.currentTarget.checked)}
                class="w-4 h-4 accent-[#DA7027]"
              />
              Hide IP (requires a TURN server, not just stun)
            </label>
            <textarea
              class="w-full h-[240px] border border-gray-700 bg-[#2B2C2F] text-white rounded p-2 font-mono text-sm"
              value={configText}
              onInput={(e) => setConfigText(e.currentTarget.value)}
            />
            {configError && (
              <p class="text-sm text-red-400 mt-1">{configError}</p>
            )}
            <div class="flex justify-between items-end text-gray-700">
              <a
                class="text-gray-300 underline"
                href="https://xirsys.com/"
                target="_blank"
                rel="noreferrer"
              >
                Can get TURN credentials here
              </a>
              <div class="flex justify-end gap-2 mt-3">
                <Button onClick={() => setConfigOpen(false)}>Cancel</Button>
                <Button onClick={handleSaveConfig}>Save</Button>
              </div>
            </div>
            Failing to connect? Players might be behind a symmetric NAT, use
            TURN servers.
          </div>
        </div>
      )}
    </>
  );
}
