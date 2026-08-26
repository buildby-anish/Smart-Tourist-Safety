// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title TouristKYCRegistry
/// @notice Anchors a pseudonymous reference to an off-chain KYC
///         verification (Suraksha Setu). Deliberately stores NOTHING but
///         hashes and a timestamp — no document numbers, names, dates of
///         birth, or photos ever reach this contract or its event logs.
///         Deploy once (Remix / Hardhat / Foundry) to Sepolia and set the
///         resulting address as SEPOLIA_CONTRACT_ADDRESS in the backend's
///         environment; backend/blockchain/sepolia_adapter.py calls
///         anchorKYC() against that deployed address, it does not deploy.
contract TouristKYCRegistry {
    /// @notice Emitted once per successful KYC anchor.
    /// @param touristIdHash keccak256 hash of the tourist's internal UUID
    ///        (never the raw UUID or any document identifier)
    /// @param verificationHash keccak256 hash of the verification payload
    ///        (issuer + document type + salt — never the raw document data)
    /// @param timestamp block timestamp at anchor time
    event KYCAnchored(bytes32 indexed touristIdHash, bytes32 verificationHash, uint256 timestamp);

    address public owner;

    constructor() {
        owner = msg.sender;
    }

    /// @notice Record a KYC anchor. Callable by anyone holding the
    ///         backend's signing key (single-writer demo deployment — for
    ///         production, restrict with onlyOwner or a role-based
    ///         allowlist instead of leaving this open).
    function anchorKYC(bytes32 touristIdHash, bytes32 verificationHash) external {
        emit KYCAnchored(touristIdHash, verificationHash, block.timestamp);
    }
}
