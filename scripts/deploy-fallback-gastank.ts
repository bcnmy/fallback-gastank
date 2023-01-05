import { ethers } from "hardhat";
import {
  SALT,
  FACTORY_ADDRESS,
  getDeployedAddress,
  deploy,
  deployFactory,
  encodeParam,
  isContract,
} from "./utils";

const options = { gasLimit: 7000000, gasPrice: 70000000000 };

async function main() {
  let tx,receipt;
  const provider = ethers.provider;

  const owner = "0x7306aC7A32eb690232De81a9FFB44Bb346026faB";
  const verifyingSigner = "0x416B03E2E5476B6a2d1dfa627B404Da1781e210d";

  // const singletonFactory = await SingletonFactory.attach(FACTORY_ADDRESS);

  const isFactoryDeployed = await isContract(FACTORY_ADDRESS, provider);
  if (!isFactoryDeployed) {
    const deployedFactory = await deployFactory(provider);
  }

  const fallbackGasTank = await ethers.getContractFactory("FallbackGasTank");
  const fallbackGasTankBytecode = `${fallbackGasTank.bytecode}${encodeParam(
    "address",
    verifyingSigner
  ).slice(2)}`;
  const fallbackGasTankComputedAddr = getDeployedAddress(
    fallbackGasTankBytecode,
    ethers.BigNumber.from(SALT)
  );
  console.log("fallbackGasTank Computed Address: ", fallbackGasTankComputedAddr);

  const isfallbackGasTankDeployed = await isContract(
    fallbackGasTankComputedAddr,
    provider
  ); // true (deployed on-chain)
  if (!isfallbackGasTankDeployed) {
    const fallbackGasTankDeployedAddr = await deploy(
      provider,
      fallbackGasTankBytecode,
      ethers.BigNumber.from(SALT)
    );
    console.log("fallbackGasTankDeployedAddr ", fallbackGasTankDeployedAddr);
    const fallbackGasTankDeploymentStatus =
    fallbackGasTankComputedAddr === fallbackGasTankDeployedAddr
        ? "Deployed Successfully"
        : false;

    console.log("fallbackGasTankDeploymentStatus ", fallbackGasTankDeploymentStatus);

    if (!fallbackGasTankDeploymentStatus) {
      console.log("Invalid fallbackGasTank Deployment");
    }
  } else {
    console.log(
      "fallbackGasTank is Already deployed with address ",
      fallbackGasTankComputedAddr
    );
  }

  const checkOwner = await fallbackGasTank.attach(fallbackGasTankComputedAddr).owner();
  console.log('owner is now ', checkOwner)

  // TODO: problem is factory becomes owner of ownable contracts hence we have to pass owner in constructor arg

  /*tx = await fallbackGasTank.attach(fallbackGasTankComputedAddr).transferOwnership(owner);
  receipt = await tx.wait();
  console.log(`Fallback gas tank ownership transferred to ${owner}`);*/
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
