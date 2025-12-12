import { AsyncResult } from "../types/Result.ts";

const PEER_CONNECTION_CONFIG: RTCConfiguration = {
  iceServers: [
    {
      urls: ["stun:stun1.l.google.com:19302", "stun:stun3.l.google.com:19302"],
    },
  ],
};

interface Peer {
  peerConnection: RTCPeerConnection;
  channels: Array<RTCDataChannel>;
  candidates: Array<RTCIceCandidate>;
}

export class WebrtcManager {
  constructor() {
    // adding map log for debugging
    // deno-lint-ignore no-explicit-any
    (globalThis as any).pmap = () => this.displayPeerMap();
  }

  private peerMap: Map<string, Peer> = new Map();
  public displayPeerMap(): void {
    console.log(this.peerMap);
  }

  public async makeHostOffers(numPeers: number): AsyncResult {
    // close all existing connections if they exist
    this.peerMap.forEach((connection) => connection.peerConnection.close());
    this.peerMap.clear();

    try {
      // create a new WebRTC peer connection for each peer joining
      const initialConnections = await Promise.all(
        Array.from({ length: numPeers }, () => makeEmptyPeer()),
      );

      for (const connection of initialConnections) {
        this.peerMap.set(crypto.randomUUID(), connection);
      }

      return { success: true };
    } catch (e) {
      return { success: false, errors: [String(e)] };
    }
  }
}

/**
 * Create a negotiated RTCPeerConnection with a chat channel id of 0
 * Fails if timeout in seconds elapses without finishing
 */
function makeEmptyPeer(timeout = 5): Promise<Peer> {
  const peerConnection = new globalThis.RTCPeerConnection(
    PEER_CONNECTION_CONFIG,
  );
  const connection: Peer = {
    peerConnection,
    channels: [],
    candidates: [],
  };

  return new Promise<Peer>((resolve, reject) => {
    peerConnection.onicecandidate = (iceEvent) => {
      if (iceEvent.candidate) {
        connection.candidates?.push(iceEvent.candidate);
        return;
      }
      // no further candidates
    };

    peerConnection.onicegatheringstatechange = (connectionEvent) => {
      const thisConnection = connectionEvent.target as RTCPeerConnection;
      switch (thisConnection.iceGatheringState) {
        case "gathering":
          // started collecting candidates
          break;
        case "complete":
          // TODO: create package / stringified elsewhere in class
          // output.package = {
          //   description: thisConnection.localDescription,
          //   candidates: output.candidates,
          //   id,
          // };
          // the connection has finished gathering ice candidates
          resolve(connection as Peer);
      }
    };

    // create a channel to transmit data in connection
    const initialChannel = peerConnection.createDataChannel("chat", {
      // initial channel for a peer connection is negotiated out of band
      negotiated: true,
      // id is agreed to be 0 for both clients
      id: 0,
    });
    initialChannel.onopen = (channelEvent) => {
      console.log("Channel to Guest was opened");
      const dataChannel = channelEvent.target as RTCDataChannel;
      console.log("new channel", dataChannel);
      // onChannelOpen(dataChannel, id)
    };
    initialChannel.onmessage = (msgEvent: MessageEvent<unknown>) => {
      // onMessageRecieved(msgEvent.data, id);
      console.log("recieved message from Guest", msgEvent);
    };
    connection.channels.push(initialChannel);

    // create offer to start generating ice candidates
    peerConnection.createOffer()
      .then((offer) => peerConnection.setLocalDescription(offer))
      .then(
        () =>
          setTimeout(
            () =>
              reject(
                `Failed gathering candidates for offer after ${timeout} seconds`,
              ),
            timeout * 1000,
          ),
      );
  });
}
