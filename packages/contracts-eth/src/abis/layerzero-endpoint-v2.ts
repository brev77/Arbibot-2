/**
 * LayerZero V2 Endpoint ABI — cross-chain message delivery verification
 * (D4-B-5-BRIDGE, L5)
 *
 * The Endpoint V2 is deployed at the SAME canonical address on every EVM chain:
 *   0x1a44076050125825900e736c501f859c50fE728c
 * (see addresses/bridge.ts LAYERZERO_ENDPOINT_V2).
 *
 * Stargate V2 bridges send messages via this endpoint. To verify a Stargate swap
 * was delivered on the destination chain, the consumer:
 *   1. Parses the `PacketSent` event from the SOURCE endpoint receipt (emitted by
 *      the source endpoint, not the Stargate router) — encodes the message header.
 *   2. Decodes the header to recover the LayerZero guid (keccak256 of
 *      abi.encodePacked(dstEid, sender padded to bytes32, nonce)).
 *   3. Calls `delivered(guid)` on the DESTINATION endpoint — returns true once the
 *      destination has executed the message.
 *
 * Reference: https://docs.layerzero.network/v2/deployments/deployed-contracts
 */
export const LayerZeroEndpointV2ABI = [
  // Read whether a cross-chain message (guid) has been delivered on this endpoint.
  // Returns true once the message has been received and executed.
  'function delivered(bytes32 guid) external view returns (bool)',

  // Read the next inbound nonce for an OApp (message-progress tracking).
  'function getInboundNonce(uint32 _eid, bytes32 _receiver) external view returns (uint64 nonce)',

  // Read the next outbound nonce for an OApp.
  'function getOutboundNonce(uint32 _eid, address _sender) external view returns (uint64 nonce)',

  // Send a message — source-side entry point (used by OApps, not the consumer).
  'function send(uint32 _dstEid, bytes32 _receiver, bytes calldata _message, bytes calldata _options, address _feeLib, bytes calldata _composeMsg) external payable returns (MessagingReceipt memory)',

  // Quote the LayerZero fee for a send.
  'function quote(uint32 _dstEid, bytes32 _receiver, bytes calldata _message, bytes calldata _options, bool _payInLzToken) external view returns (MessagingFee memory)',

  // Emitted by the SOURCE endpoint when a packet is dispatched (the consumer parses
  // this to recover the guid / destination eid / nonce).
  'event PacketSent(bytes encodedPayload, bytes options)',

  // Emitted by the DESTINATION endpoint when a packet is received (delivery proof).
  'event PacketReceived(uint32 srcEid, bytes32 receiver, uint64 nonce, bytes32 payloadHash)',

  // Emitted when a message is delivered and executed on the destination.
  'event MsgExecuted(bytes32 guid, ExecutionState state)',

  // Solidity tuple types referenced above (for ABI decoding only).
  'struct MessagingReceipt { bytes32 guid; uint64 nonce; uint256 fee; }',
  'struct MessagingFee { uint256 nativeFee; uint256 lzTokenFee; }',
  'enum ExecutionState { NotSupported, Verified, Blocked, Failed, Success }',
] as const;

/**
 * LayerZero V2 message header layout (for guid construction).
 *
 * The guid is `keccak256(abi.encodePacked(dstEid, senderPadded32, nonce))`.
 * The PacketSent payload is: [version][wire format] where wire format starts with
 * the message header: dstEid (uint32) | sender (bytes32) | nonce (uint64).
 *
 * These offsets are used by StargateBridgeAdapter to extract the guid.
 */
export const LZ_V2_HEADER = {
  /** offset of dstEid (uint32) within the PacketSent payload (after version byte). */
  DST_EID_OFFSET: 1,
  /** length of dstEid field. */
  DST_EID_LEN: 4,
  /** offset of sender (bytes32) within the PacketSent payload. */
  SENDER_OFFSET: 5,
  /** length of sender field. */
  SENDER_LEN: 32,
  /** offset of nonce (uint64) within the PacketSent payload. */
  NONCE_OFFSET: 37,
  /** length of nonce field. */
  NONCE_LEN: 8,
} as const;
