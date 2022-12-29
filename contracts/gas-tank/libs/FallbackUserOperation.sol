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

        address sender; // smart account // review: can be renamed to target
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
}