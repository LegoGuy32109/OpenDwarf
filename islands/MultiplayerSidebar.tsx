import { useState } from "preact/hooks";
import { Button } from "../components/Button.tsx";
import { WebrtcManager } from "../domain/webrtc.ts";

const webrtc = new WebrtcManager();
type RemotePayload = { key: string; sdp: string };

export default function MultiplayerSidebar() {
  const [open, setOpen] = useState(false);

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
      await navigator.clipboard.writeText(
        JSON.stringify(offerResult.payload),
      );
      console.log("Offer payload copied to clipboard");
    } catch (e) {
      console.error("Failed to copy offer payload", e);
    }
  };

  const readClipboardPayload = async (): Promise<
    Array<RemotePayload> | null
  > => {
    try {
      const text = await navigator.clipboard.readText();
      const parsed = JSON.parse(text);
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
      await navigator.clipboard.writeText(
        JSON.stringify(answerResult.payload),
      );
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

  return (
    <>
      <div>
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
    </>
  );
}
