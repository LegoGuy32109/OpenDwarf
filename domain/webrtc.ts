const peerConnectionConfig: RTCConfiguration = {
  iceServers: [
    {
      urls: ["stun:stun1.l.google.com:19302", "stun:stun3.l.google.com:19302"],
    },
  ],
};

// object containing room connections, set when HOST
let roomConnections: any = {};

// object containing info about host, set when GUEST
let hostConnection = {};

type Integer = number & { __int__: void };

async function generateRoomConnections(numConnections: Integer) {
  // close all existing connections if they exist
  for (const connection in roomConnections) {
    if (connection.peerConnection) {
      connection.peerConnection.close();
    }
  }

  // create a new WebRTC peer connection for each peer joining
  const connections = await Promise.all(
    Array.from({ length: numConnections }, () => generateRoomConnection()),
  );
}

interface Output {
  peerConnection: RTCPeerConnection;
  channel?: RTCDataChannel;
  candidates: Array<RTCIceCandidate>;
  package: unknown;
}

// create a connection in generateRoomConnections, will be called MAX_ROOM_SIZE times
async function generateRoomConnection() {
  const peerConnection = new globalThis.RTCPeerConnection(peerConnectionConfig);
  const output: Output = {
    peerConnection,
    channel: undefined,
    candidates: [],
    package: undefined,
  };
  // assign an id, so we can match answers to offers later
  const id = globalThis.crypto.randomUUID();

  peerConnection.onicecandidate = (iceEvent) => {
    if (iceEvent.candidate) {
      output.candidates.push(iceEvent.candidate);
      return;
    }
    console.log("no further candidates", iceEvent);
  };

  peerConnection.onicegatheringstatechange = (event) => {
    const thisConnection = event.target as RTCPeerConnection;
    switch (thisConnection.iceGatheringState) {
      case "gathering":
        // started collecting candidates
        break;
      case "complete":
        output.package = {
          description: thisConnection.localDescription,
          candidates: output.candidates,
          id,
        };
        // setIceGatheringComplete("Completed")
    }
  };

  // create a channel to transmit data in connection
  output.channel = peerConnection.createDataChannel("chat", {
    negotiated: true,
    id: 0,
  });
  output.channel.onopen = (event) => {
    console.log("Channel to Guest was opened")
    const dataChannel = event.target as RTCDataChannel
    // onChannelOpen(dataChannel, id)
  }
  output.channel.onmessage = (msgEvent: MessageEvent<{data: unknown}>) => {
    // onMessageRecieved(msgEvent.data, id);
    console.log("recieved message from Guest", msgEvent)
  }

  // create offer to start generating ice candidates
  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);
}
