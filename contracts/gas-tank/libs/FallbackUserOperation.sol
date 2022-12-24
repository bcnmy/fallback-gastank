// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.12;

/* solhint-disable no-inline-assembly */


// review : There might be an addition for baseGas offset that can be passed with the request
/**
     * Fallback User SCW Operation struct
     * @param sender smart account for this request
     * @param nonce unique value the sender uses to verify it is not a replay.
     * @param callData the method call to execTransaction on this account.
     * @param callGasLimit gas used for execTransaction call to the account
     * @param dappIdentifier dapp identifier for which deposit will be deducted
     * @param signature verifying-signer-verified signature over the entire request
     */
    struct FallbackUserOperation {

        address sender; // smart account
        uint256 nonce;
        bytes callData;
        uint256 callGasLimit;
        address dappIdentifier;
        bytes signature;
    }

library FallbackUserOperationLib {

    function getSender(FallbackUserOperation calldata fallbackUserOp) internal pure returns (address) {
        address data;
        //read sender from userOp, which is first userOp member (saves 800 gas...)
        assembly {data := calldataload(fallbackUserOp)}
        return address(uint160(data));
    }

    function pack(FallbackUserOperation calldata fallbackUserOp) internal pure returns (bytes memory ret) {
        //lighter signature scheme. must match UserOp.ts#packUserOp
        bytes calldata sig = fallbackUserOp.signature;
        // copy directly the userOp from calldata up to (but not including) the signature.
        // this encoding depends on the ABI encoding of calldata, but is much lighter to copy
        // than referencing each field separately.
        assembly {
            let ofs := fallbackUserOp
            let len := sub(sub(sig.offset, ofs), 32)
            ret := mload(0x40)
            mstore(0x40, add(ret, add(len, 32)))
            mstore(ret, len)
            calldatacopy(add(ret, 32), ofs, len)
        }
    }

    function hash(FallbackUserOperation calldata fallbackUserOp) internal pure returns (bytes32) {
        return keccak256(pack(fallbackUserOp));
    }
}