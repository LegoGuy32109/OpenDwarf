import { AsyncResult, Result } from "../types/Result.ts";
import { makeError } from "./Result.ts";

const PEER_CONNECTION_CONFIG: RTCConfiguration = {
  iceServers: [
    {
      urls: ["stun:stun1.l.google.com:19302", "stun:stun3.l.google.com:19302"],
    },
  ],
};

interface Peer {
  key: string; // uuid
  peerConnection: RTCPeerConnection;
  channels: Array<RTCDataChannel>;
  candidates: Array<RTCIceCandidate>;
}

interface RemotePeer {
  key: string; // uuid
  description: RTCSessionDescription;
  candidates: Array<RTCIceCandidate>;
}

export class WebrtcManager {
  constructor() {
    // adding map logs for debugging
    // deno-lint-ignore no-explicit-any
    (globalThis as any).pmap = () => this.displayPeerMap();
    // deno-lint-ignore no-explicit-any
    (globalThis as any).amap = () => this.displayAnswerMap();
  }

  private peerMap: Map<string, Peer> = new Map();
  public displayPeerMap(): void {
    console.log(this.peerMap);
  }

  private answeringPeerMap: Map<string, Peer> = new Map();
  public displayAnswerMap(): void {
    console.log(this.answeringPeerMap);
  }

  public async makeOfferingPeers(numPeers: number): AsyncResult {
    // close all existing connections if they exist
    this.peerMap.forEach((peer) => peer.peerConnection.close());
    this.peerMap.clear();

    try {
      // create a new WebRTC peer connection for each peer joining
      const peers = await Promise.all(
        Array.from({ length: numPeers }, () => makeEmptyPeer()),
      );

      for (const peer of peers) {
        this.peerMap.set(peer.key, peer);
      }

      return { ok: true };
    } catch (e) {
      return { ok: false, errors: [String(e)] };
    }
  }

  public getOfferPayload(): Result<{ payload: Array<RemotePeer> }> {
    const payload: Array<RemotePeer> = [];
    this.peerMap.forEach((peer) => {
      if (peer.peerConnection.localDescription) {
        payload.push({
          key: peer.key,
          description: peer.peerConnection.localDescription,
          candidates: peer.candidates,
        });
      }
    });

    if (payload.length === 0) {
      return { ok: false, errors: ["No Local Offers exist"] };
    }
    return { ok: true, payload };
  }

  public async makeGuestAnswers(remotePeers: Array<RemotePeer>): AsyncResult {
    // close all existing connections if they exist
    this.answeringPeerMap.forEach((connection) =>
      connection.peerConnection.close()
    );
    this.answeringPeerMap.clear();

    if (remotePeers.length === 0) {
      return { ok: false, errors: ["No remote peers given"] };
    }

    try {
      // create a new WebRTC peer connection for each remote peer
      const possibleAnswerPeers = await Promise.all(
        remotePeers.map(makeAnsweringPeer),
      );

      for (const answer of possibleAnswerPeers) {
        this.answeringPeerMap.set(crypto.randomUUID(), answer);
      }

      return { ok: true };
    } catch (e) {
      return { ok: false, errors: [String(e)] };
    }
  }

  public getAnswerPayload(): Result<{ payload: Array<RemotePeer> }> {
    const payload: Array<RemotePeer> = [];
    this.answeringPeerMap.forEach((peer) => {
      if (peer.peerConnection.localDescription) {
        payload.push({
          key: peer.key,
          description: peer.peerConnection.localDescription,
          candidates: peer.candidates,
        });
      }
    });

    if (payload.length === 0) {
      return makeError("No Local Answers exist");
    }
    return { ok: true, payload };
  }

  public recieveAnswerPayload(
    remotePeers: Array<RemotePeer>,
  ): Result {
    if (remotePeers.length === 0) {
      return makeError("No remote peers given");
    }

    const peers = Array.from(this.peerMap.entries());
    if (peers.length === 0) {
      return makeError("No Local Offers exist");
    }
    const remotePeerKeys = remotePeers.map((peer) => peer.key);
    const openPeers = peers.filter(([key, peer]) =>
      !peer.peerConnection.remoteDescription && remotePeerKeys.includes(key)
    );
    if (openPeers.length === 0) {
      return makeError("No Open Offers exist");
    }

    const [key, openPeer] = openPeers[0];
    const remotePeer = remotePeers.find((peer) => peer.key === key);
    if (!remotePeer) {
      return makeError("Remote Peer filtering invalid, BUG");
    }
    openPeer.peerConnection.setRemoteDescription(remotePeer.description);

    return { ok: true };
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
  const peer: Peer = {
    key: crypto.randomUUID(),
    peerConnection,
    channels: [],
    candidates: [],
  };

  return new Promise<Peer>((resolve, reject) => {
    peerConnection.onicecandidate = (iceEvent) => {
      if (iceEvent.candidate) {
        peer.candidates?.push(iceEvent.candidate);
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
          resolve(peer as Peer);
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
    peer.channels.push(initialChannel);

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

function makeAnsweringPeer(remotePeer: RemotePeer): Promise<Peer> {
  const peerConnection = new RTCPeerConnection(PEER_CONNECTION_CONFIG);
  const peer: Peer = {
    key: remotePeer.key,
    peerConnection,
    channels: [],
    candidates: [],
  };

  return new Promise<Peer>((resolve, reject) => {
    peerConnection.onicecandidate = (iceEvent) => {
      if (iceEvent.candidate) {
        peer.candidates?.push(iceEvent.candidate);
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
          resolve(peer as Peer);
      }
    };

    peerConnection.setRemoteDescription(remotePeer.description);

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
    peer.channels.push(initialChannel);

    // create answer to offer to start generating ice candidates
    const timeout = 5;
    peerConnection.createAnswer()
      .then((answer) => peerConnection.setLocalDescription(answer))
      .then(
        () =>
          setTimeout(
            () =>
              reject(
                `Failed adding candidates for answer after ${timeout} seconds`,
              ),
            timeout * 1000,
          ),
      )
      .then(async () => {
        // add all the candidates in any order
        await Promise.all(
          remotePeer.candidates.map((candidate) =>
            peerConnection.addIceCandidate(candidate)
          ),
        );
        // To indicate the offer had no more candidates, pass in undefined
        await peerConnection.addIceCandidate(undefined);
      });
  });
}
