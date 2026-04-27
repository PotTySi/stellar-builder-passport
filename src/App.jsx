import { useState } from "react";
import {
  Address,
  BASE_FEE,
  Contract,
  Networks,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
} from "@stellar/stellar-sdk";
import {
  isConnected,
  requestAccess,
  signTransaction,
} from "@stellar/freighter-api";
import "./App.css";

const CONTRACT_ID = import.meta.env.VITE_CONTRACT_ID;

const DEFAULT_SOURCE =
  "GCSGI4ZRPWFZV3DZMHNRELFJXJ6YELBV3LDADK7AWUHSELBLPAU4UT42";

const RPC_URL = "https://soroban-testnet.stellar.org";

const server = new rpc.Server(RPC_URL);
const contract = new Contract(CONTRACT_ID);

function App() {
  const [publicKey, setPublicKey] = useState("");
  const [status, setStatus] = useState("Ready");
  const [txHash, setTxHash] = useState("");
  const [badgeInfo, setBadgeInfo] = useState("Not loaded");
  const [points, setPoints] = useState("Not loaded");
  const [badgeStatus, setBadgeStatus] = useState("Not checked");
  const [lastEvent, setLastEvent] = useState("No activity yet");

  function setPending(message) {
    setStatus(`Pending: ${message}`);
  }

  function setSuccess(message, hash = "") {
    setStatus(`Success: ${message}`);

    if (hash) {
      setTxHash(hash);
    }
  }

  function setFailed(message) {
    setStatus(`Failed: ${message}`);
    setTxHash("");
  }

  function handleError(error) {
    console.error(error);

    const message = String(error?.message || error || "").toLowerCase();

    if (
      message.includes("wallet") ||
      message.includes("not connected") ||
      message.includes("freighter")
    ) {
      setFailed("Wallet not found or not connected.");
      return;
    }

    if (
      message.includes("reject") ||
      message.includes("decline") ||
      message.includes("denied")
    ) {
      setFailed("Transaction rejected by user.");
      return;
    }

    if (message.includes("already")) {
      setFailed("This action has already been completed.");
      return;
    }

    if (
      message.includes("not enough") ||
      message.includes("insufficient") ||
      message.includes("host error") ||
      message.includes("contract error")
    ) {
      setFailed("Not enough points or invalid contract state.");
      return;
    }

    setFailed("Unknown error. Please check wallet, network, and contract state.");
  }

  function selectUnavailableWallet(walletName) {
    setStatus(`${walletName}: Coming soon`);
    setTxHash("");
    setLastEvent(`${walletName} selected`);
  }

  async function connectWallet() {
    try {
      setPending("Checking Freighter wallet");

      const connected = await isConnected();

      if (!connected.isConnected) {
        setFailed("Wallet not found or not connected.");
        setLastEvent("Wallet connection failed");
        return;
      }

      const access = await requestAccess();

      if (access.error) {
        setFailed("Transaction rejected by user.");
        setLastEvent("Wallet connection rejected");
        return;
      }

      setPublicKey(access.address);
      setSuccess("Freighter wallet connected");
      setLastEvent("Wallet connected");
    } catch (error) {
      handleError(error);
    }
  }

  function disconnectWallet() {
    setPublicKey("");
    setStatus("Wallet disconnected");
    setTxHash("");
    setLastEvent("Wallet disconnected");
    setPoints("Not loaded");
    setBadgeStatus("Not checked");
  }

  async function readContract(functionName, args = []) {
    const source = publicKey || DEFAULT_SOURCE;
    const account = await server.getAccount(source);

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(contract.call(functionName, ...args))
      .setTimeout(30)
      .build();

    const simulated = await server.simulateTransaction(tx);

    if (rpc.Api.isSimulationError(simulated)) {
      throw new Error(simulated.error);
    }

    if (!simulated.result || !simulated.result.retval) {
      throw new Error("No result returned from contract simulation");
    }

    return simulated.result.retval;
  }

  async function writeContract(functionName, args = []) {
    if (!publicKey) {
      throw new Error("Wallet not connected");
    }

    const account = await server.getAccount(publicKey);

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(contract.call(functionName, ...args))
      .setTimeout(30)
      .build();

    setPending("Simulating transaction");

    const simulated = await server.simulateTransaction(tx);

    if (rpc.Api.isSimulationError(simulated)) {
      throw new Error(simulated.error);
    }

    const preparedTx = rpc.assembleTransaction(tx, simulated).build();

    setPending("Waiting for wallet signature");

    const signed = await signTransaction(preparedTx.toXDR(), {
      networkPassphrase: Networks.TESTNET,
      address: publicKey,
    });

    if (signed.error) {
      throw new Error("Transaction rejected by user");
    }

    const signedXdr = typeof signed === "string" ? signed : signed.signedTxXdr;
    const signedTx = TransactionBuilder.fromXDR(signedXdr, Networks.TESTNET);

    setPending("Submitting transaction");

    const sendResponse = await server.sendTransaction(signedTx);

    if (sendResponse.status === "ERROR") {
      throw new Error("Transaction submission failed");
    }

    let result = await server.getTransaction(sendResponse.hash);

    while (result.status === "NOT_FOUND") {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      result = await server.getTransaction(sendResponse.hash);
    }

    if (result.status !== "SUCCESS") {
      throw new Error("Transaction failed on-chain");
    }

    return sendResponse.hash;
  }

  async function getBadgeInfo() {
    try {
      setPending("Reading badge information");

      const result = await readContract("get_badge", [
        nativeToScVal(1, { type: "u32" }),
      ]);

      const data = scValToNative(result);

      setBadgeInfo(`${data.name} / ${data.required_points} points required`);
      setSuccess("Badge information loaded");
      setLastEvent("Read: get_badge");
    } catch (error) {
      handleError(error);
    }
  }

  async function getMyPoints() {
    try {
      if (!publicKey) {
        setFailed("Please connect wallet first.");
        return;
      }

      setPending("Reading wallet points");

      const result = await readContract("get_points", [
        new Address(publicKey).toScVal(),
      ]);

      const data = scValToNative(result);

      setPoints(String(data));
      setSuccess("Wallet points loaded");
      setLastEvent("Read: get_points");
    } catch (error) {
      handleError(error);
    }
  }

  async function claimDemoPoints() {
    try {
      if (!publicKey) {
        setFailed("Please connect wallet first.");
        return;
      }

      const hash = await writeContract("claim_demo_points", [
        new Address(publicKey).toScVal(),
      ]);

      const pointResult = await readContract("get_points", [
        new Address(publicKey).toScVal(),
      ]);

      const data = scValToNative(pointResult);

      setPoints(String(data));
      setSuccess("Demo points claimed", hash);
      setLastEvent("Write: claim_demo_points");
    } catch (error) {
      handleError(error);
    }
  }

  async function claimBadge() {
    try {
      if (!publicKey) {
        setFailed("Please connect wallet first.");
        return;
      }

      setPending("Checking points before claim");

      const pointResult = await readContract("get_points", [
        new Address(publicKey).toScVal(),
      ]);

      const currentPoints = Number(scValToNative(pointResult));
      setPoints(String(currentPoints));

      if (currentPoints < 50) {
        setFailed("Not enough points to claim this badge.");
        setLastEvent("Claim blocked: not enough points");
        return;
      }

      const hash = await writeContract("claim_badge", [
        new Address(publicKey).toScVal(),
        nativeToScVal(1, { type: "u32" }),
      ]);

      const badgeResult = await readContract("has_badge", [
        new Address(publicKey).toScVal(),
        nativeToScVal(1, { type: "u32" }),
      ]);

      const badgeData = scValToNative(badgeResult);

      setBadgeStatus(String(badgeData));
      setSuccess("Badge claimed", hash);
      setLastEvent("Write: claim_badge");
    } catch (error) {
      handleError(error);
    }
  }

  async function checkMyBadge() {
    try {
      if (!publicKey) {
        setFailed("Please connect wallet first.");
        return;
      }

      setPending("Checking wallet badge");

      const result = await readContract("has_badge", [
        new Address(publicKey).toScVal(),
        nativeToScVal(1, { type: "u32" }),
      ]);

      const data = scValToNative(result);

      setBadgeStatus(String(data));
      setSuccess("Wallet badge status loaded");
      setLastEvent("Sync: wallet badge status updated");
    } catch (error) {
      handleError(error);
    }
  }

  return (
    <main className="page">
      <section className="card">
        <p className="level">Level 2 Stellar dApp</p>

        <h1>Stellar Builder Passport</h1>

        <p className="subtitle">
          A frontend dApp for connecting a wallet, reading contract data,
          writing contract data, and tracking transaction status on Stellar
          Testnet.
        </p>

        <div className="box">
          <h2>Wallet Options</h2>

          <div className="wallet-table">
            <button className="wallet-option active" onClick={connectWallet}>
              Freighter
            </button>

            <button
              className="wallet-option"
              onClick={() => selectUnavailableWallet("xBull")}
            >
              xBull
            </button>

            <button
              className="wallet-option"
              onClick={() => selectUnavailableWallet("Lobstr")}
            >
              Lobstr
            </button>

            <button
              className="wallet-option"
              onClick={() => selectUnavailableWallet("Rabet")}
            >
              Rabet
            </button>

            <button
              className="wallet-option"
              onClick={() => selectUnavailableWallet("Albedo")}
            >
              Albedo
            </button>

            <button
              className="wallet-option"
              onClick={() => selectUnavailableWallet("Ledger")}
            >
              Ledger
            </button>
          </div>
        </div>

        <div className="box">
          <h2>Contract</h2>
          <p className="mono">{CONTRACT_ID}</p>
        </div>

        {publicKey && (
          <div className="box">
            <h2>Connected Wallet</h2>
            <p className="mono">{publicKey}</p>

            <button className="secondary" onClick={disconnectWallet}>
              Disconnect Wallet
            </button>
          </div>
        )}

        <div className="grid">
          <button onClick={getBadgeInfo}>Get Badge Info</button>
          <button onClick={getMyPoints}>Get My Points</button>
          <button onClick={claimDemoPoints}>Claim Demo Points</button>
          <button onClick={claimBadge}>Claim Badge</button>
          <button onClick={checkMyBadge}>Check My Badge</button>
        </div>

        <div className="box">
          <h2>Builder Passport</h2>
          <p>
            <strong>Badge:</strong> {badgeInfo}
          </p>
          <p>
            <strong>Points:</strong> {points}
          </p>
          <p>
            <strong>Has Badge:</strong> {badgeStatus}
          </p>
        </div>

        <div className="box">
          <h2>Transaction Status</h2>

          <p className={status.startsWith("Failed") ? "error" : ""}>
            {status}
          </p>

          {txHash && (
            <>
              <p>
                <strong>Transaction Hash:</strong>
              </p>

              <p className="mono">{txHash}</p>

              <a
                href={`https://stellar.expert/explorer/testnet/tx/${txHash}`}
                target="_blank"
                rel="noreferrer"
              >
                Open on Stellar Expert
              </a>
            </>
          )}
        </div>

        <div className="box">
          <h2>Activity Feed</h2>
          <p>{lastEvent}</p>
        </div>
      </section>
    </main>
  );
}

export default App;