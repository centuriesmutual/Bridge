import { readFile } from 'node:fs/promises';
import * as grpc from '@grpc/grpc-js';
import {
  connect,
  type Gateway,
  type Network,
  type Contract as FabricContract,
} from '@hyperledger/fabric-gateway';
import { loadEnv } from '../config/env.js';
import { loadIdentity, loadSigner } from './identity.js';
import { logger } from '../lib/logger.js';

/**
 * Fabric Gateway connection management.
 *
 * Wraps the official `@hyperledger/fabric-gateway` gRPC client. We keep a
 * single long-lived gateway + gRPC channel for the process lifetime.
 *
 * The bridge is a CLIENT of a network defined elsewhere (`centuries-ledger`);
 * we never bootstrap peers/orderers here.
 */

let gateway: Gateway | null = null;
let grpcClient: grpc.Client | null = null;

async function newGrpcConnection(): Promise<grpc.Client> {
  const env = loadEnv();
  if (!env.FABRIC_TLS_CERT_PATH) {
    throw new Error('FABRIC_TLS_CERT_PATH is required to establish the gRPC connection.');
  }
  const tlsRootCert = await readFile(env.FABRIC_TLS_CERT_PATH);
  const tlsCredentials = grpc.credentials.createSsl(tlsRootCert);
  const options: grpc.ChannelOptions = {};
  if (env.FABRIC_GATEWAY_HOST_ALIAS) {
    // gRPC TLS SNI override so the cert CN/SAN matches the docker hostname.
    options['grpc.ssl_target_name_override'] = env.FABRIC_GATEWAY_HOST_ALIAS;
  }
  return new grpc.Client(env.FABRIC_GATEWAY_ENDPOINT, tlsCredentials, options);
}

export async function getGateway(): Promise<Gateway> {
  if (gateway) return gateway;
  const [identity, signer] = await Promise.all([loadIdentity(), loadSigner()]);
  grpcClient = await newGrpcConnection();
  gateway = connect({
    client: grpcClient,
    identity,
    signer,
    // Conservative per-call timeouts. Commit can be slow; keep it generous.
    evaluateOptions: () => ({ deadline: Date.now() + 5_000 }),
    endorseOptions: () => ({ deadline: Date.now() + 15_000 }),
    submitOptions: () => ({ deadline: Date.now() + 5_000 }),
    commitStatusOptions: () => ({ deadline: Date.now() + 60_000 }),
  });
  logger.info('Fabric gateway connected');
  return gateway;
}

export async function getNetwork(): Promise<Network> {
  const env = loadEnv();
  const gw = await getGateway();
  return gw.getNetwork(env.FABRIC_CHANNEL);
}

export async function getChaincodeContract(contractName: string): Promise<FabricContract> {
  const env = loadEnv();
  const network = await getNetwork();
  // A single chaincode package can expose multiple named contracts.
  return network.getContract(env.FABRIC_CHAINCODE_NAME, contractName);
}

export function closeGateway(): void {
  gateway?.close();
  grpcClient?.close();
  gateway = null;
  grpcClient = null;
}
