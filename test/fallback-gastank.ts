import { expect } from "chai";
import { ethers } from "hardhat";
import {
    SmartWallet,
    WalletFactory,
    EntryPointSA,
    TestToken,
    MultiSend,
    MultiSendCallOnly,
    StorageSetter,
    DefaultCallbackHandler,
    FallbackGasTank,
} from "../typechain";
import { arrayify } from 'ethers/lib/utils'
import { encodeTransfer } from "./testUtils";
import {
    buildContractCall,
    MetaTransaction,
    SafeTransaction,
    Transaction,
    FeeRefund,
    executeTx,
    safeSignTypedData,
    safeSignMessage,
    buildSafeTransaction,
    executeContractCallWithSigners,
} from "../src/utils/execution";
import {
    encodeMultiSend,
    buildMultiSendSafeTx,
  } from "../src/utils/multisend";
import { Signer } from "ethers";

describe("Singleton GasTank relaying to a Smart Account", function () {
    let baseImpl: SmartWallet;
    let walletFactory: WalletFactory;
    let entryPoint: EntryPointSA;
    let token: TestToken;
    let multiSend: MultiSend;
    let multiSendCall: MultiSendCallOnly;
    let storage: StorageSetter;
    let owner: string;
    let bob: string;
    let faizal: Signer;
    let snoopdog: Signer;
    let charlie: string;
    let dapp1: string;
    let userSCW: any;
    let handler: DefaultCallbackHandler;
    let relayGasTank: FallbackGasTank;
    const VERSION = '1.0.4'
    let accounts: any;

    /* const domainType = [
      { name: "name", type: "string" },
      { name: "version", type: "string" },
      { name: "verifyingContract", type: "address" },
      { name: "salt", type: "bytes32" },
    ]; */

    before(async () => {
        // TODO update wallet contracts , factory and entry point as per latest
        accounts = await ethers.getSigners();
        const addresses = await ethers.provider.listAccounts();
        const ethersSigner = ethers.provider.getSigner();

        owner = await accounts[0].getAddress();
        bob = await accounts[1].getAddress();
        charlie = await accounts[2].getAddress();
        dapp1 = await accounts[3].getAddress();
        faizal = await accounts[4];
        snoopdog = await accounts[5];

        const EntryPoint = await ethers.getContractFactory("EntryPoint");
        entryPoint = await EntryPoint.deploy();
        await entryPoint.deployed();
        console.log("Entry point deployed at: ", entryPoint.address);

        const DefaultHandler = await ethers.getContractFactory(
         "DefaultCallbackHandler"
        );
        handler = await DefaultHandler.deploy();
        await handler.deployed();
        console.log("Default callback handler deployed at: ", handler.address);

        const BaseImplementation = await ethers.getContractFactory("SmartAccount");
        baseImpl = await BaseImplementation.deploy(entryPoint.address);
        await baseImpl.deployed();
        console.log("base wallet impl deployed at: ", baseImpl.address);

        const WalletFactory = await ethers.getContractFactory("SmartAccountFactory");
        walletFactory = await WalletFactory.deploy(baseImpl.address, handler.address);
        await walletFactory.deployed();
        console.log("wallet factory deployed at: ", walletFactory.address);

        const TestToken = await ethers.getContractFactory("TestToken");
        token = await TestToken.deploy();
        await token.deployed();
        console.log("Test token deployed at: ", token.address);

        const FallbackGasTank = await ethers.getContractFactory(
            "FallbackGasTank"
        );
        relayGasTank = await FallbackGasTank.deploy(
            owner,
            await faizal.getAddress()
        );
        await relayGasTank.deployed();
        console.log("FallbackGasTank deployed at: ", relayGasTank.address);


        const Storage = await ethers.getContractFactory("StorageSetter");
        storage = await Storage.deploy();
        console.log("storage setter contract deployed at: ", storage.address);

        const MultiSendCallOnly = await ethers.getContractFactory("MultiSendCallOnly");
        multiSendCall = await MultiSendCallOnly.deploy();
        console.log("Multisend Call Only helper contract deployed at: ", multiSendCall.address);

        const MultiSend = await ethers.getContractFactory("MultiSend");
        multiSend = await MultiSend.deploy();
        console.log("Multisend helper contract deployed at: ", multiSend.address);

        console.log("mint tokens to owner address..");
        await token.mint(owner, ethers.utils.parseEther("1000000"));
    });

    // describe("Wallet initialization", function () {
    it("Should set the correct states on proxy", async function () {
        const expected = await walletFactory.getAddressForCounterfactualWallet(
            owner,
            0
        );
        console.log("deploying new wallet..expected address: ", expected);

        await expect(
            walletFactory.deployCounterFactualWallet(
                owner,
                0
            )
        )
            .to.emit(walletFactory, "SmartAccountCreated")
            .withArgs(expected, baseImpl.address, owner, VERSION, 0);

        userSCW = await ethers.getContractAt(
            "contracts/test/smart-contract-wallet/SmartAccount.sol:SmartAccount",
            expected
        );

        const entryPointAddress = await userSCW.entryPoint();
        expect(entryPointAddress).to.equal(entryPoint.address);

        const walletOwner = await userSCW.owner();
        expect(walletOwner).to.equal(owner);

        const walletNonce1 = await userSCW.getNonce(0); // only 0 space is in the context now // always use .nonce() for AA and getNonce(1) for forward/fallback 
        const walletNonce2 = await userSCW.getNonce(1);
        const chainId = await userSCW.getChainId();

        console.log("walletNonce1 ", walletNonce1);
        console.log("walletNonce2 ", walletNonce2);
        console.log("chainId ", chainId);

        await accounts[1].sendTransaction({
            from: bob,
            to: expected,
            value: ethers.utils.parseEther("5"),
        });
    });

    it("Should process the deposits", async function () {

        const balanceBefore = await relayGasTank.getBalance(dapp1);
        console.log('balance before ', balanceBefore.toString());

        await relayGasTank.connect(accounts[0]).depositFor(dapp1, { value: ethers.utils.parseEther("1") });

        const balanceAfter = await relayGasTank.getBalance(dapp1);
        console.log('balance after ', balanceAfter.toString());

        expect(balanceAfter.sub(balanceBefore)).to.equal(ethers.utils.parseEther("1"));
    });

    it("Only owner should be able to withdraw deposit", async function () {

        const balanceNow = await relayGasTank.getBalance(dapp1);
        console.log('current deposit ', balanceNow.toString());

        await expect(relayGasTank.connect(accounts[1]).
            withdrawGasForDapp(dapp1, bob, ethers.utils.parseEther("0.5")))
            .to.be.revertedWith('Ownable: caller is not the owner');

        await relayGasTank.connect(accounts[0]).
            withdrawGasForDapp(dapp1, bob, ethers.utils.parseEther("0.5"));

        const balanceAfter = await relayGasTank.getBalance(dapp1);
        console.log('balance after ', balanceAfter.toString());

        expect(balanceAfter).to.be.equal(ethers.utils.parseEther("0.5"));
    });

    it("Admin functions: update baseGas and verifyingSigner", async function () {
    });

    it("Relay SCW gasless transaction and charge dapp for gas from tank", async function () {
        let tx, receipt;

        const dappGasTankBalanceBefore = await relayGasTank.getBalance(dapp1);
        console.log('dapp deposit before ', dappGasTankBalanceBefore.toString())

        await token
            .connect(accounts[0])
            .transfer(userSCW.address, ethers.utils.parseEther("100"));

        const safeTx: SafeTransaction = buildSafeTransaction({
            to: token.address,
            // value: ethers.utils.parseEther("1"),
            data: encodeTransfer(charlie, ethers.utils.parseEther("10").toString()),
            nonce: await userSCW.getNonce(1),
        });

        const chainId = await userSCW.getChainId();
        const { signer, data } = await safeSignMessage(
            accounts[0],
            userSCW,
            safeTx,
            chainId
        );

        console.log(safeTx);

        const transaction: Transaction = {
            to: safeTx.to,
            value: safeTx.value,
            data: safeTx.data,
            operation: safeTx.operation,
            targetTxGas: safeTx.targetTxGas,
        };
        const refundInfo: FeeRefund = {
            baseGas: safeTx.baseGas,
            gasPrice: safeTx.gasPrice,
            tokenGasPriceFactor: safeTx.tokenGasPriceFactor,
            gasToken: safeTx.gasToken,
            refundReceiver: safeTx.refundReceiver,
        };

        console.log('refund info')
        console.log(refundInfo)

        let signature = "0x";
        signature += data.slice(2);

        const execTransaction = await userSCW.populateTransaction.execTransaction(
            transaction,
            refundInfo,
            signature
        )

        console.log('call data for fallback user operation is ')
        console.log(execTransaction.data)

        const nonceFromGasTank = await relayGasTank.getNonce(userSCW.address);

        let fallbackUserOp = {
            sender: userSCW.address,
            target: userSCW.address,
            nonce: nonceFromGasTank.toNumber(),
            callData: execTransaction.data,
            callGasLimit: execTransaction.gasLimit,
            dappIdentifier: dapp1,
            signature: '0x'
        }

        const hashToSign = await relayGasTank.getHash(fallbackUserOp)
        const sig = await faizal.signMessage(arrayify(hashToSign))

        fallbackUserOp.signature = sig;

        console.log('fallback userop')
        console.log(fallbackUserOp)

        const relayerAddress = await snoopdog.getAddress();
        const relayBalanceBefore = await ethers.provider.getBalance(relayerAddress);
        console.log('relayer balance before ', relayBalanceBefore.toString())

        await expect(
            relayGasTank.connect(snoopdog).handleFallbackUserOp(
                fallbackUserOp
            )
        ).to.emit(relayGasTank, "GaslessTxExecuted")
            .to.emit(userSCW, "ExecutionSuccess"); //.withArgs(relayerAddress, userSCW.address)

        // get payment from event logs

        expect(await token.balanceOf(charlie)).to.equal(
            ethers.utils.parseEther("10")
        );

        // ^ just like this balance nonce in relayGasTank contract should have been updated by 1!

        const relayBalanceAfter = await ethers.provider.getBalance(relayerAddress);
        console.log('relayer balance after ', relayBalanceAfter.toString())

        const dappGasTankBalanceAfter = await relayGasTank.getBalance(dapp1);
        console.log('dapp deposit after ', dappGasTankBalanceAfter.toString())
    });

    it("Relay to gas tank should fail with wrong signature in fallback userOp", async function () {
        let tx, receipt;

        const dappGasTankBalanceBefore = await relayGasTank.getBalance(dapp1);
        console.log('dapp deposit before ', dappGasTankBalanceBefore.toString())

        await token
            .connect(accounts[0])
            .transfer(userSCW.address, ethers.utils.parseEther("100"));

        const safeTx: SafeTransaction = buildSafeTransaction({
            to: token.address,
            // value: ethers.utils.parseEther("1"),
            data: encodeTransfer(charlie, ethers.utils.parseEther("10").toString()),
            nonce: await userSCW.getNonce(1),
        });

        const chainId = await userSCW.getChainId();
        const { signer, data } = await safeSignMessage(
            accounts[0],
            userSCW,
            safeTx,
            chainId
        );

        console.log(safeTx);

        const transaction: Transaction = {
            to: safeTx.to,
            value: safeTx.value,
            data: safeTx.data,
            operation: safeTx.operation,
            targetTxGas: safeTx.targetTxGas,
        };
        const refundInfo: FeeRefund = {
            baseGas: safeTx.baseGas,
            gasPrice: safeTx.gasPrice,
            tokenGasPriceFactor: safeTx.tokenGasPriceFactor,
            gasToken: safeTx.gasToken,
            refundReceiver: safeTx.refundReceiver,
        };

        console.log('refund info')
        console.log(refundInfo)

        let signature = "0x";
        signature += data.slice(2);

        const execTransaction = await userSCW.populateTransaction.execTransaction(
            transaction,
            refundInfo,
            signature
        )

        console.log('call data for fallback user operation is ')
        console.log(execTransaction.data)

        console.log('gaslimit for fallback user operation is ')
        console.log(execTransaction.gasLimit)

        const nonceFromGasTank = await relayGasTank.getNonce(userSCW.address);

        let fallbackUserOp = {
            sender: userSCW.address,
            target: userSCW.address,
            nonce: nonceFromGasTank.toNumber(),
            callData: execTransaction.data,
            callGasLimit: execTransaction.gasLimit,
            dappIdentifier: dapp1,
            signature: '0x'
        }

        const hashToSign = await relayGasTank.getHash(fallbackUserOp)
        const sig = await snoopdog.signMessage(arrayify(hashToSign))

        fallbackUserOp.signature = sig;

        const relayerAddress = await snoopdog.getAddress();
        const relayBalanceBefore = await ethers.provider.getBalance(relayerAddress);
        console.log('relayer balance before ', relayBalanceBefore.toString())

        await expect(
            relayGasTank.connect(snoopdog).handleFallbackUserOp(
                fallbackUserOp
            )
        ).to.be.revertedWith("FallbackGasTank: wrong signature")
    });

    it("Relay SCW gasless transaction and charge dapp for gas from tank and compare gas deductions", async function () {
        let tx, receipt;

        const RelayGasTank = await ethers.getContractFactory("FallbackGasTank");

        const dappGasTankBalanceBefore = await relayGasTank.getBalance(dapp1);
        console.log('dapp deposit before ', dappGasTankBalanceBefore.toString())

        await token
            .connect(accounts[0])
            .transfer(userSCW.address, ethers.utils.parseEther("100"));

        const safeTx: SafeTransaction = buildSafeTransaction({
            to: token.address,
            // value: ethers.utils.parseEther("1"),
            data: encodeTransfer(charlie, ethers.utils.parseEther("10").toString()),
            nonce: await userSCW.getNonce(1),
        });

        const chainId = await userSCW.getChainId();
        const { signer, data } = await safeSignMessage(
            accounts[0],
            userSCW,
            safeTx,
            chainId
        );

        console.log(safeTx);

        const transaction: Transaction = {
            to: safeTx.to,
            value: safeTx.value,
            data: safeTx.data,
            operation: safeTx.operation,
            targetTxGas: safeTx.targetTxGas,
        };
        const refundInfo: FeeRefund = {
            baseGas: safeTx.baseGas,
            gasPrice: safeTx.gasPrice,
            tokenGasPriceFactor: safeTx.tokenGasPriceFactor,
            gasToken: safeTx.gasToken,
            refundReceiver: safeTx.refundReceiver,
        };

        console.log('refund info')
        console.log(refundInfo)

        let signature = "0x";
        signature += data.slice(2);

        const execTransaction = await userSCW.populateTransaction.execTransaction(
            transaction,
            refundInfo,
            signature
        )

        console.log('call data for fallback user operation is ')
        console.log(execTransaction.data)

        const nonceFromGasTank = await relayGasTank.getNonce(userSCW.address);
        console.log('nonceFromGasTank ', nonceFromGasTank.toString())

        let fallbackUserOp = {
            sender: userSCW.address,
            target: userSCW.address,
            nonce: nonceFromGasTank.toNumber(),
            callData: execTransaction.data,
            callGasLimit: execTransaction.gasLimit,
            dappIdentifier: dapp1,
            signature: '0x'
        }

        const hashToSign = await relayGasTank.getHash(fallbackUserOp)
        const sig = await faizal.signMessage(arrayify(hashToSign))

        fallbackUserOp.signature = sig;

        const relayerAddress = await snoopdog.getAddress();
        const relayBalanceBefore = await ethers.provider.getBalance(relayerAddress);
        console.log('relayer balance before ', relayBalanceBefore.toString())

        // bumping up base gas
        await relayGasTank.connect(accounts[0]).setBaseGas(53000);


        tx = await relayGasTank.connect(snoopdog).handleFallbackUserOp(fallbackUserOp);

        receipt = await tx.wait(1);

        console.log('receipt.logs')
        console.log(receipt.logs)

        console.log("gasPrice: ", tx.gasPrice);
        console.log("real txn gas used: ", receipt.gasUsed.toNumber());

        /*const eventLogs = RelayGasTank.interface.decodeEventLog(
            "GaslessTxExecuted",
            receipt.logs[2].topics[3]
          );*/
        const paymentDeducted = ethers.BigNumber.from(receipt.logs[2].topics[3]).toString();
        console.log("payment deducted ", paymentDeducted);
      
        const gasFees = receipt.gasUsed.mul(receipt.effectiveGasPrice);
        console.log("gasFees", gasFees.toNumber());

        // get payment from event logs

        expect(await token.balanceOf(charlie)).to.equal(
            ethers.utils.parseEther("20")
        );

        // ^ just like this balance nonce in relayGasTank contract should have been updated by 1!

        const relayBalanceAfter = await ethers.provider.getBalance(relayerAddress);
        console.log('relayer balance after ', relayBalanceAfter.toString())

        const dappGasTankBalanceAfter = await relayGasTank.getBalance(dapp1);
        console.log('dapp deposit after ', dappGasTankBalanceAfter.toString())

        expect(dappGasTankBalanceBefore.sub(dappGasTankBalanceAfter))
        .to.equal(ethers.BigNumber.from(paymentDeducted));

        // TODO : gas deduction assertions
        // Relayer pays gas but also receives refund so before - after balance diff should be nearly 0
        // The payment received by relayer should equals balance that got deduted for the dapp
    });

    it("Wallet deployment + Relay SCW gasless transaction and charge dapp for gas from tank", async function () {
        let tx, receipt;

        const MultiSend = await ethers.getContractFactory("MultiSendCallOnly");

        const expected = await walletFactory.getAddressForCounterfactualWallet(
            owner,
            10
          );
        console.log("deploying new wallet in this transaction..expected address: ", expected);

        const dappGasTankBalanceBefore = await relayGasTank.getBalance(dapp1);
        console.log('dapp deposit before ', dappGasTankBalanceBefore.toString())

        await token
            .connect(accounts[0])
            .transfer(expected, ethers.utils.parseEther("100"));

        const safeTx: SafeTransaction = buildSafeTransaction({
            to: token.address,
            // value: ethers.utils.parseEther("1"),
            data: encodeTransfer(charlie, ethers.utils.parseEther("10").toString()),
            nonce: 0, // nonce picked 0 for first transaction
        });

        const chainId = await userSCW.getChainId();
        userSCW = userSCW.attach(expected);
        const { signer, data } = await safeSignMessage(
            accounts[0],
            userSCW,
            safeTx,
            chainId
        );

        console.log(safeTx);

        const transaction: Transaction = {
            to: safeTx.to,
            value: safeTx.value,
            data: safeTx.data,
            operation: safeTx.operation,
            targetTxGas: safeTx.targetTxGas,
        };
        const refundInfo: FeeRefund = {
            baseGas: safeTx.baseGas,
            gasPrice: safeTx.gasPrice,
            tokenGasPriceFactor: safeTx.tokenGasPriceFactor,
            gasToken: safeTx.gasToken,
            refundReceiver: safeTx.refundReceiver,
        };

        console.log('refund info')
        console.log(refundInfo)

        let signature = "0x";
        signature += data.slice(2);

        const txs: MetaTransaction[] = [
            buildContractCall(
              walletFactory,
              "deployCounterFactualWallet",
              [owner, 10],
              0
            ),
            buildContractCall(
              userSCW,
              "execTransaction",
              [transaction, refundInfo, signature],
              0
            ),
          ];

        const multiSendTx = await multiSendCall.populateTransaction.multiSend( encodeMultiSend(txs) );
      
        /*const txnData = MultiSend.interface.encodeFunctionData("multiSend", [
            encodeMultiSend(txs),
          ]);*/

        /*const execTransaction = await userSCW.populateTransaction.execTransaction(
            transaction,
            0,
            refundInfo,
            signature
        )*/

        console.log('call data for fallback user operation is ')
        console.log(multiSendTx.data)

        const nonceFromGasTank = await relayGasTank.getNonce(userSCW.address);

        let fallbackUserOp = {
            sender: expected, // target changes here
            target: multiSendCall.address,
            nonce: nonceFromGasTank.toNumber(),
            callData: multiSendTx.data,
            callGasLimit: multiSendTx.gasLimit,
            dappIdentifier: dapp1,
            signature: '0x'
        }

        const hashToSign = await relayGasTank.getHash(fallbackUserOp)
        const sig = await faizal.signMessage(arrayify(hashToSign))

        fallbackUserOp.signature = sig;

        const relayerAddress = await snoopdog.getAddress();
        const relayBalanceBefore = await ethers.provider.getBalance(relayerAddress);
        console.log('relayer balance before ', relayBalanceBefore.toString())

        await expect(
            relayGasTank.connect(snoopdog).handleFallbackUserOp(
                fallbackUserOp
            )
        ).to.emit(relayGasTank, "GaslessTxExecuted")
            .to.emit(userSCW, "ExecutionSuccess") //.withArgs(relayerAddress, userSCW.address)
             .to.emit(walletFactory,"SmartAccountCreated"); //.withArgs

        // get payment from event logs

        /*expect(await token.balanceOf(charlie)).to.equal(
            ethers.utils.parseEther("30")
        );*/

        // ^ just like this balance nonce in relayGasTank contract should have been updated by 1!

        const relayBalanceAfter = await ethers.provider.getBalance(relayerAddress);
        console.log('relayer balance after ', relayBalanceAfter.toString())

        const dappGasTankBalanceAfter = await relayGasTank.getBalance(dapp1);
        console.log('dapp deposit after ', dappGasTankBalanceAfter.toString())
    });

    // Todo: other ways of signature mismatch and nonce mismatch (replay attacks) checks

});

