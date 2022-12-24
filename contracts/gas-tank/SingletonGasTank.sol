// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "./libs/FallbackUserOperation.sol";

// possibly imports account interface 

// relay request is essentially userop sender info (wallet address) + signature + dapp identifier
// hence we could have some struct similar to UserOperation and import it from libs 

// todo add Reentrancy  Guard
contract SingletonGasTank is Ownable {
    using ECDSA for bytes32;
    using FallbackUserOperationLib for FallbackUserOperation;

    /** */
    // States

    // @review Could be used to prevent front-running
    // mapping(address => bool) public relayers;

    mapping(address => uint256) public dappIdentifierBalances;
    address public verifyingSigner;
    //transaction base gas
    uint128 public baseGas=21000;
    // nonce for account 
    mapping(address => uint256) private nonces;

    // FallbackUserOp struct
    // comes from library

    
    /** */
    // Modifiers

    /*modifier onlyRelayer {
        require(relayers[msg.sender], "Only relayer can call this function.");
        _;
    }*/


    //** read methods */
    function getNonce(address _sender) external view returns(uint256 nonce) {
        nonce = nonces[_sender];
    }

    /** */
    //Events

    // event RelayerInstalled(address relayer);
    // event RelayerUninstalled(address relayer);
    
    // Dapp deposits
    // should emit dappIdentifier and Amount
    event Deposit(address indexed sender, uint256 indexed amount, address indexed dappIdentifier); 
    /* Designed to enable the community to track change in storage variable baseGas which is used for charge calcuations 
       Unlikely to change */
    event BaseGasChanged(uint128 newBaseGas, address indexed actor);


    function setBaseGas(uint128 gas) external onlyOwner{
        baseGas = gas;
        emit BaseGasChanged(baseGas,msg.sender);
    }

    /**
    this function will let owner change signer
    */
    function setSigner( address _newVerifyingSigner) external onlyOwner{
        require(_newVerifyingSigner != address(0), "SingletonGasTank: new signer can not be zero address");
        verifyingSigner = _newVerifyingSigner;
    }

    /**
     * add a deposit for given dappIdentifier (Dapp Depositor address), used for paying for transaction fees
     */
    function depositFor(address dappIdentifier) public payable {
        require(!Address.isContract(dappIdentifier), "dappIdentifier can not be smart contract address");
        require(dappIdentifier != address(0), "dappIdentifier can not be zero address");
        dappIdentifierBalances[dappIdentifier] += msg.value;
        // Emits an event
        emit Deposit(msg.sender, msg.value, dappIdentifier);
    }

    /**
     * return the hash we're going to sign off-chain (and validate on-chain)
     * this method is called by the off-chain service, to sign the request.
     * it is called on-chain from the handleFallbackUserop, to validate the signature.
     * note that this signature covers all fields of the FallbackUserOperation, except the "signature",
     * which is the signature itself.
     */
    function getHash(FallbackUserOperation calldata fallbackUserOp)
    public pure returns (bytes32) {
        //can't use userOp.hash(), since it contains also the paymasterAndData itself.
        return keccak256(abi.encode(
                fallbackUserOp.getSender(),
                fallbackUserOp.nonce,
                keccak256(fallbackUserOp.callData),
                fallbackUserOp.callGasLimit,
                fallbackUserOp.dappIdentifier
            ));
    }

    function _validateSignature(FallbackUserOperation calldata fallbackUserOp) internal view {

        bytes32 hash = getHash(fallbackUserOp);
        uint256 sigLength = fallbackUserOp.signature.length;

        //ECDSA library supports both 64 and 65-byte long signatures.
        // we only "require" it here so that the revert reason on invalid signature will be of "VerifyingPaymaster", and not "ECDSA"
        require(sigLength == 64 || sigLength == 65, "SingletonGasTank: invalid signature length in fallbackUserOp");
        require(verifyingSigner == hash.toEthSignedMessageHash().recover(fallbackUserOp.signature), "SingletonGasTank: wrong signature");
    }

    function _validateAndUpdateNonce(FallbackUserOperation calldata fallbackUserOp) internal {
        require(nonces[fallbackUserOp.sender]++ == fallbackUserOp.nonce, "account: invalid nonce");
    }

    // execution
    // if relayers whitelisting involve add modifier onlyRelayer
    function handleFallbackUserop(
        FallbackUserOperation calldata fallbackUserOp
    ) external 
    {
        _validateSignature(fallbackUserOp);
        _validateAndUpdateNonce(fallbackUserOp);

        uint256 gasStarted = gasleft();
        (bool success,) = fallbackUserOp.sender.call{gas : fallbackUserOp.callGasLimit}(fallbackUserOp.callData);
        // Validate that the relayer has sent enough gas for the call.
        // See https://ronan.eth.link/blog/ethereum-gas-dangers/
        // assert(gasleft() > req.txGas / 63);
        // _verifyCallResult(success,ret,"Forwarded call to destination did not succeed");

        uint256 gasUsed = gasStarted - gasleft(); // Takes into account gas cost for refund. 
        uint256 actualGasCost = gasUsed * tx.gasprice;

        if(!payable(msg.sender).send(actualGasCost)) {
            // Notify that contract is out of gas.
        }

        // deduct funds
        dappIdentifierBalances[fallbackUserOp.dappIdentifier] -= actualGasCost;
        // emit event with payment, dapp details, relayer address and refund...
    }
}

